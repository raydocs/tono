//! `tono_core::HttpTransport` over the app's reqwest stack:
//! redirects disabled, cookies disabled, 30 s connect / 45 s total timeouts (the
//! mainland-link budget; the pinned attempt connects within 10 s so its fallback still fits the
//! launch restore budget), and a 2 MiB response cap. The Bearer token is computed by
//! `ApiClient` and carried on the request; this layer only passes it through.
//!
//! F1: the API hostname is DNS-pinned to the bootstrap IPs (see
//! `tono::bootstrap`). Pinning is safe because TLS/SNI still validates the
//! hostname against Cloudflare's certificate — it changes only where the
//! TCP connection lands, and it keeps the control plane reachable while the
//! kill switch blocks the system resolver. This is the *only* HTTP client
//! the account/catalog API traffic uses; the mihomo controller client
//! (loopback) is separate and unpinned by design.
//!
//! Retries do NOT live here: the bounded retry policy (GET any kind once,
//! POST only Dns/Connect) is inside `ApiClient` in tono-core — this layer
//! only classifies failures so it can decide.

use std::time::Duration;

use anyhow::{Context as _, Result};
use async_trait::async_trait;
use tono_core::auth::{
    ApiError, ApiRequest, ApiResponse, HttpMethod, HttpTransport, TransportKind,
    should_retry_transport,
};

use crate::tono::bootstrap;

/// §1 response size cap.
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
/// §1 mainland-link timeouts (connect 30 s / total 45 s).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const TOTAL_TIMEOUT: Duration = Duration::from_secs(45);
/// Connect budget of the pinned attempt only (#583).
///
/// Every request tries the pinned addresses first, and a network that drops them costs this much
/// before the system-resolver fallback may run. At the shared 30 s it equalled the whole launch
/// restore budget (`RESTORE_TRANSACTION_TIMEOUT`), so restore expired inside the pinned connect and
/// the fallback never ran at launch. Restore sends two requests in sequence (token refresh, then
/// `me`) and each pays this once, so it stays well under half of that budget; 10 s still covers
/// two SYN retransmissions on a lossy link (Windows retransmits at 3 s and 9 s). Only the connect
/// phase is bounded: a connect that runs out of time delivered nothing, so the fallback's delivery
/// rule is unchanged.
const PINNED_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Platform and app version on every request, so the control plane can record
/// which build signs in, refreshes and fetches the catalog even when no
/// telemetry is sent. Nothing account- or network-specific.
const CLIENT_HEADER: &str = concat!("windows/", env!("CARGO_PKG_VERSION"));

/// The path carrying one attempt, sent as `X-Tono-Path` on that attempt.
///
/// The control plane records it on the device row, so ops can tell which path a device last
/// used: a relayed request otherwise arrives from the relay node's address, which looks like a
/// connected exit node. Set per attempt, so the same request re-sent on another path carries
/// that path's value. Names a path, never an address or anything account-specific.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AttemptPath {
    /// The compiled and learned Cloudflare pins on 443.
    Pinned,
    /// Whatever the system resolver returns, on 443.
    SystemDns,
    /// A Tono-owned relay (`bootstrap::API_RELAYS`).
    Relay,
    /// Addresses from DNS-over-HTTPS, on 443.
    Doh,
    /// The pins on an alternate Cloudflare HTTPS port.
    AltPort,
    /// The already-running loopback tunnel.
    Tunnel,
}

impl AttemptPath {
    const fn header_value(self) -> &'static str {
        match self {
            AttemptPath::Pinned => "pinned",
            AttemptPath::SystemDns => "system_dns",
            AttemptPath::Relay => "relay",
            AttemptPath::Doh => "doh",
            AttemptPath::AltPort => "alt_port",
            AttemptPath::Tunnel => "tunnel",
        }
    }
}

/// A19: one control-plane path that failed provably undelivered, reported when the next path
/// starts, like the macOS `control_plane_path_failed` audit event. Path labels (the
/// `X-Tono-Path` values), the failure class and the time spent: never an address, URL, host or
/// account value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PathFailure {
    pub path: &'static str,
    pub next_path: &'static str,
    pub reason: &'static str,
    pub elapsed_ms: u64,
}

/// Receives each [`PathFailure`]. Must not block: it runs inline before the next attempt.
pub(crate) type PathFailureSink = Box<dyn Fn(PathFailure) + Send + Sync>;

tokio::task_local! {
    /// The failed attempt of the current `send` waiting to learn which path follows it. Scoped
    /// per `send`, so a failure is never paired with another request's attempt.
    static PENDING_PATH_FAILURE: std::cell::Cell<Option<(AttemptPath, &'static str, u64)>>;
}

/// Map a reqwest failure onto the retry-policy classification (§1).
///
/// Ordering matters, and it is `is_connect()` first. reqwest sets *both*
/// `is_connect()` and `is_timeout()` for a connect that timed out, so checking
/// timeout first filed it as `Timeout` — a bucket the retry policy treats as "may
/// already have been delivered" and therefore never retries for POST or DELETE.
///
/// That was wrong on its own terms. `Connect` covers DNS resolution and TCP
/// connect, and in either phase no HTTP bytes have gone out; a connect that ran
/// out of time delivered exactly as much as one that was refused, which is
/// nothing. Verified against reqwest rather than assumed, and pinned by
/// `a_connect_that_times_out_is_not_an_ambiguous_timeout`:
///
///   dropped packets   is_connect=true  is_timeout=true
///   refused           is_connect=true  is_timeout=false
///
/// The distinction is not academic. Packets to a blocked address are dropped, not
/// refused, so every user behind such a block produced the ambiguous kind — and
/// the one request that matters on the sign-in screen is a POST.
///
/// A timeout *without* `is_connect()` is a genuine read/response timeout, where
/// the request may well have arrived, and stays ambiguous.
/// TLS-layer failures surface only in the debug chain
/// (handshake/certificate/rustls).
pub(crate) fn classify(err: &reqwest::Error) -> TransportKind {
    if err.is_connect() {
        return TransportKind::Connect;
    }
    if err.is_timeout() {
        return TransportKind::Timeout;
    }
    let debug = format!("{err:?}").to_lowercase();
    if debug.contains("tls")
        || debug.contains("certificate")
        || debug.contains("handshake")
        || debug.contains("ssl")
        || debug.contains("rustls")
    {
        return TransportKind::Tls;
    }
    TransportKind::Other
}

/// The classification, as a word the operator can read.
///
/// `classify` already works this out to drive the retry policy, and until now it
/// was discarded for reporting: the only text a user or a screenshot ever carried
/// was reqwest's `error sending request for url (...)`, which is the same sentence
/// whether the name did not resolve, the TCP connect was refused, or the
/// certificate failed to validate. A support report built from it cannot be acted
/// on, and one such report cost a full round of guessing.
fn kind_label(kind: TransportKind) -> &'static str {
    match kind {
        TransportKind::Dns => "dns",
        TransportKind::Connect => "connect",
        TransportKind::Tls => "tls",
        TransportKind::Timeout => "timeout",
        TransportKind::Other => "other",
    }
}

/// `reqwest`'s own `Display` stops at "error sending request for url"; the reason
/// lives in the `source()` chain below it. Both are needed: the chain says *what*
/// failed ("no such host", "connection refused", "certificate verify failed") and
/// the label says which phase it failed in.
fn describe(err: &reqwest::Error) -> String {
    use std::error::Error as _;
    let kind = kind_label(classify(err));
    // H21-O-F8: a refused certificate is named by its class only. rustls renders the names a
    // mismatched certificate presents (a portal's own host), and those must not reach the
    // error text that support reports and diagnostics carry.
    if let Some(refused) = refused_certificate(err) {
        return mark_tls_interception(err, format!("{kind}: {err} <- invalid peer certificate: {refused}"));
    }
    let mut text = format!("{kind}: {err}");
    let mut source = err.source();
    let mut depth = 0;
    while let Some(cause) = source {
        // Bounded: a source chain is short, and an error message is not a place
        // to discover otherwise.
        if depth >= 4 {
            break;
        }
        let rendered = cause.to_string();
        // Chains often repeat the layer above verbatim; repeating it in the UI
        // buys nothing and pushes the useful end of the chain out of view.
        if !text.contains(&rendered) {
            text.push_str(" <- ");
            text.push_str(&rendered);
        }
        source = cause.source();
        depth += 1;
    }
    mark_tls_interception(err, mark_clock_skew(err, text))
}

/// Stable marker for a certificate the system clock cannot date (#588).
///
/// A clock far off makes every certificate look expired or not yet valid, and NTP is
/// blocked while protection is on, so "could not reach Tono" leaves the user nothing to
/// fix. The kind is left as it was: the failure is still a transport failure for the retry
/// policy and for offline admission (no status line arrived), and only the text the user
/// reads changes. The frontend matches `TONO_CLOCK_SKEW:` anywhere in an error, ahead of
/// the surface's own prefix.
pub(crate) const CLOCK_SKEW: &str = "TONO_CLOCK_SKEW";

/// `text`, marked with [`CLOCK_SKEW`] when `err` carries a rustls certificate-validity
/// failure.
pub(crate) fn mark_clock_skew(err: &(dyn std::error::Error + 'static), text: String) -> String {
    if is_certificate_time_error(err) {
        format!("{CLOCK_SKEW}: {text}")
    } else {
        text
    }
}

/// Whether the chain holds rustls's expired / not-yet-valid certificate error, from webpki
/// (`*Context`) or the Windows platform verifier (`CERT_E_EXPIRED` → `Expired`).
fn is_certificate_time_error(err: &(dyn std::error::Error + 'static)) -> bool {
    use rustls::CertificateError as Certificate;
    chain_certificate_error(err, |certificate| {
        matches!(
            certificate,
            Certificate::Expired
                | Certificate::ExpiredContext { .. }
                | Certificate::NotValidYet
                | Certificate::NotValidYetContext { .. }
        )
        .then_some(())
    })
    .is_some()
}

/// H21-O-F8: `text`, marked with [`tono_core::network_interference::TLS_INTERCEPTED`] when
/// `err` carries a certificate the trust store refused for its issuer, signature or name.
///
/// Read-only: validation already failed and stays failed; this only names the cause. Neither
/// the certificate nor its names are added to the text.
pub(crate) fn mark_tls_interception(err: &(dyn std::error::Error + 'static), text: String) -> String {
    if is_certificate_trust_error(err) {
        format!("{}: {text}", tono_core::network_interference::TLS_INTERCEPTED)
    } else {
        text
    }
}

fn is_certificate_trust_error(err: &(dyn std::error::Error + 'static)) -> bool {
    refused_certificate(err).is_some()
}

/// An unknown issuer (the platform verifier's `CERT_E_UNTRUSTEDROOT`), a bad signature, or a
/// certificate for another name (`CERT_E_CN_NO_MATCH`): what a TLS-intercepting proxy, or a
/// portal answering for Tono's host, presents. Dates, revocation and encoding do not count.
/// A fixed label, never the certificate's names.
fn refused_certificate(err: &(dyn std::error::Error + 'static)) -> Option<&'static str> {
    use rustls::CertificateError as Certificate;
    chain_certificate_error(err, |certificate| match certificate {
        Certificate::UnknownIssuer => Some("unknown issuer"),
        Certificate::BadSignature => Some("bad signature"),
        Certificate::NotValidForName | Certificate::NotValidForNameContext { .. } => Some("not valid for this host"),
        _ => None,
    })
}

/// What `pick` makes of the first rustls certificate error in the chain.
///
/// `io::Error::source` skips the error it wraps, and hyper-rustls wraps tokio-rustls's
/// `io::Error` in another, so each `io::Error` is opened with `get_ref` as well.
fn chain_certificate_error<T>(
    err: &(dyn std::error::Error + 'static),
    pick: fn(&rustls::CertificateError) -> Option<T>,
) -> Option<T> {
    let mut current = Some(err);
    let mut depth = 0;
    while let Some(cause) = current {
        // Bounded like `describe`: a chain is short.
        if depth >= 8 {
            break;
        }
        if let Some(rustls::Error::InvalidCertificate(certificate)) =
            cause.downcast_ref::<rustls::Error>()
        {
            return pick(certificate);
        }
        if let Some(io) = cause.downcast_ref::<std::io::Error>()
            && let Some(inner) = io.get_ref()
            && let Some(picked) = chain_certificate_error(inner, pick)
        {
            return Some(picked);
        }
        current = cause.source();
        depth += 1;
    }
    None
}

pub struct TonoTransport {
    /// Reaches the control plane only at the pinned bootstrap addresses.
    ///
    /// Behind a lock so a protected learn can rebuild the pin set mid-session
    /// without replacing the whole `ApiClient`.
    client: tokio::sync::RwLock<reqwest::Client>,
    /// Reaches it through whatever the system resolver returns.
    ///
    /// The pins exist so a fully-armed kill switch cannot lock the client out of
    /// its own control plane: with DNS blocked, literal addresses are the only way
    /// back. But they were applied unconditionally and with no alternative, which
    /// turned a recovery mechanism into the single point of failure — two
    /// Cloudflare anycast addresses are the *whole* reachable set for every user,
    /// and a network that drops those two can never sign in, while the same
    /// machine's browser succeeds because DNS hands it a different edge.
    ///
    /// This client is tried only after the pinned one fails, and only when the
    /// failure proves no bytes were delivered. When the kill switch really is
    /// blocking, this attempt simply fails too: DNS is unavailable, and the WFP
    /// permit covers the pinned addresses only. It can add a success; it cannot
    /// take one away.
    resolved: reqwest::Client,
    /// The alternate HTTPS port that last worked, or 0.
    ///
    /// Remembered for the process, not persisted. Once 443 has proven unreachable on this
    /// network, paying for that failure on every later request is the difference between a
    /// usable app and one that stalls on each call — and when 443 is *dropped* rather than
    /// reset, that failure costs the full connect timeout. A fresh start re-tries 443 first,
    /// so a network that recovers is not stuck on an alternate for ever.
    alternate_port: std::sync::atomic::AtomicU16,
    /// The system-resolved client answered after the pinned addresses failed (#583).
    ///
    /// Later requests try it first. Launch restore sends a token refresh and then `me` inside
    /// one budget; without this, `me` paid the pinned connect budget a second time before
    /// reaching the path that had just worked, and the budget ran out before its fallback.
    /// Cleared when a preferred attempt fails or is cancelled (`PreferenceLease`), after which
    /// the pinned path runs as usual, so under an armed kill switch (pins permitted, DNS blocked)
    /// the cost is one failed resolution. Process memory only, like `alternate_port`.
    prefer_resolved: std::sync::atomic::AtomicBool,
    /// `resolved` with the pinned attempt's connect budget, used only while `prefer_resolved` is
    /// set, so a resolver that has become a blackhole costs 10 s before the pins, not 30 s.
    resolved_first: reqwest::Client,
    /// Responses whose status line arrived (#582). Launch restore reads it around a budget
    /// timeout: an unchanged count is the only proof that the control plane gave no answer.
    answers: std::sync::atomic::AtomicU64,
    /// Loopback mixed port of a tunnel this process already started, or 0.
    ///
    /// Auth may try it last. Setting it does not create a tunnel, change a
    /// route, or install a filter. Cleared when the tunnel is released.
    tunnel_port: std::sync::atomic::AtomicU16,
    /// Tono-owned relays outside Cloudflare (`bootstrap::API_RELAYS`), one client each.
    ///
    /// Tried right after the pinned and system-resolved attempts have both failed provably
    /// undelivered, and before DoH: DoH hands back Cloudflare addresses, which for the customer
    /// this exists for sit on the same broken path. The relay passes the TLS session through
    /// unterminated, so the certificate check is the same one as on every other path.
    relays: Vec<Relay>,
    /// Index + 1 of the relay that last answered, or 0.
    ///
    /// Later requests go to it first, like `alternate_port`: for a customer whose Cloudflare
    /// path drops, every request would otherwise pay the pinned and the resolved connect
    /// budgets again before reaching the one path that works. Cleared on a provably
    /// undelivered failure, so a network that recovers goes back to the pins. Process memory
    /// only.
    preferred_relay: std::sync::atomic::AtomicUsize,
    /// A19: where path failures go (the audit log, then the periodic timeline). None in tests
    /// that do not ask for it.
    path_failure_sink: Option<PathFailureSink>,
}

/// One compiled relay: where the TCP connection lands and the client that lands it there.
struct Relay {
    address: std::net::SocketAddr,
    client: reqwest::Client,
}

/// Connect budget of one relay attempt. The relay is on a different network path than
/// Cloudflare, so it is either reachable within a few round trips or not at all; a long wait
/// here would only delay the remaining fallbacks for a customer who is already waiting.
pub(crate) const RELAY_CONNECT_TIMEOUT: Duration = Duration::from_secs(4);

/// Holds `prefer_resolved` for one preferred attempt and clears it on drop unless the attempt
/// was answered. A failure, and a cancellation by an outer deadline (launch restore), both
/// clear it, so the next request goes to the pins first.
struct PreferenceLease<'a> {
    flag: &'a std::sync::atomic::AtomicBool,
    answered: bool,
}

impl Drop for PreferenceLease<'_> {
    fn drop(&mut self) {
        if !self.answered {
            self.flag.store(false, std::sync::atomic::Ordering::Relaxed);
        }
    }
}

impl TonoTransport {
    pub fn new() -> Result<Self> {
        let resolved = Self::builder()
            .build()
            .context("failed to build the Tono HTTP fallback client")?;
        Ok(Self {
            client: tokio::sync::RwLock::new(Self::build_pinned_client()?),
            resolved,
            alternate_port: std::sync::atomic::AtomicU16::new(0),
            prefer_resolved: std::sync::atomic::AtomicBool::new(false),
            answers: std::sync::atomic::AtomicU64::new(0),
            resolved_first: Self::pinned_builder()
                .build()
                .context("failed to build the Tono HTTP preferred-fallback client")?,
            tunnel_port: std::sync::atomic::AtomicU16::new(0),
            relays: Self::build_relays(bootstrap::API_HOST, &bootstrap::api_relays(), || {
                Self::builder().connect_timeout(RELAY_CONNECT_TIMEOUT)
            })?,
            preferred_relay: std::sync::atomic::AtomicUsize::new(0),
            path_failure_sink: None,
        })
    }

    /// Report every path failure that is followed by another path to `sink` (A19).
    pub(crate) fn with_path_failure_sink(mut self, sink: PathFailureSink) -> Self {
        self.path_failure_sink = Some(sink);
        self
    }

    /// One client per relay, pinned to that relay's socket for `host`. Everything else is the
    /// shared builder: no proxy, no redirects, full certificate validation against `host`.
    fn build_relays(
        host: &str,
        addresses: &[std::net::SocketAddr],
        builder: impl Fn() -> reqwest::ClientBuilder,
    ) -> Result<Vec<Relay>> {
        addresses
            .iter()
            .map(|address| {
                Ok(Relay {
                    address: *address,
                    client: builder()
                        .resolve_to_addrs(host, std::slice::from_ref(address))
                        .build()
                        .context("failed to build a Tono HTTP relay client")?,
                })
            })
            .collect()
    }

    /// Publish the live loopback mixed port, or 0 when it is gone.
    pub fn set_auth_tunnel_port(&self, port: u16) {
        self.tunnel_port
            .store(port, std::sync::atomic::Ordering::Relaxed);
    }

    /// The relay preference (`preferred_relay`), shared with the updater's GETs so an update
    /// check on a device whose sign-in went through a relay goes there first instead of paying
    /// the dead direct path again. Both sides index `bootstrap::api_relays()` and clear it on a
    /// provably undelivered relay failure.
    pub(crate) fn preferred_relay(&self) -> &std::sync::atomic::AtomicUsize {
        &self.preferred_relay
    }

    /// How many responses have delivered a status line so far (#582).
    pub fn answers_seen(&self) -> u64 {
        self.answers.load(std::sync::atomic::Ordering::Acquire)
    }

    /// Rebuild the pinned client from the current compiled + learned set.
    pub async fn refresh_control_plane_pins(&self) -> Result<()> {
        let client = Self::build_pinned_client()?;
        *self.client.write().await = client;
        Ok(())
    }

    fn build_pinned_client() -> Result<reqwest::Client> {
        let pinned: Vec<std::net::SocketAddr> = bootstrap::control_plane_http_pins()
            .into_iter()
            .map(|ip| std::net::SocketAddr::new(std::net::IpAddr::V4(ip), 443))
            .collect();
        Self::pinned_builder()
            .resolve_to_addrs(bootstrap::API_HOST, &pinned)
            .build()
            .context("failed to build the Tono HTTP client")
    }

    /// The shared settings with the pinned attempt's shorter connect budget.
    fn pinned_builder() -> reqwest::ClientBuilder {
        Self::builder().connect_timeout(PINNED_CONNECT_TIMEOUT)
    }

    /// Same wiring, with both clients' resolution supplied.
    ///
    /// The behaviour under test is "when the pinned client fails, is the other one
    /// tried, and does its result stand" — so a test drives both sides. Leaving the
    /// second client on the real system resolver would make the test depend on how
    /// `localhost` happens to resolve on the host, which is how three earlier
    /// versions of it ended up asserting nothing.
    ///
    /// A short connect timeout so a deliberately unroutable pinned address fails in
    /// milliseconds instead of the production 30 s.
    #[cfg(test)]
    fn with_clients(
        host: &str,
        pinned: &[std::net::SocketAddr],
        resolved: &[std::net::SocketAddr],
    ) -> Result<Self> {
        Self::with_clients_and_relays(host, pinned, resolved, &[])
    }

    /// `with_clients` plus the relay sockets, each with the same quick budget.
    #[cfg(test)]
    fn with_clients_and_relays(
        host: &str,
        pinned: &[std::net::SocketAddr],
        resolved: &[std::net::SocketAddr],
        relays: &[std::net::SocketAddr],
    ) -> Result<Self> {
        let quick = || {
            Self::builder()
                .connect_timeout(Duration::from_millis(700))
                .timeout(Duration::from_millis(900))
        };
        Ok(Self {
            relays: Self::build_relays(host, relays, quick)?,
            preferred_relay: std::sync::atomic::AtomicUsize::new(0),
            client: tokio::sync::RwLock::new(
                quick()
                    .resolve_to_addrs(host, pinned)
                    .build()
                    .context("failed to build the pinned test client")?,
            ),
            resolved: quick()
                .resolve_to_addrs(host, resolved)
                .build()
                .context("failed to build the resolving test client")?,
            alternate_port: std::sync::atomic::AtomicU16::new(0),
            prefer_resolved: std::sync::atomic::AtomicBool::new(false),
            answers: std::sync::atomic::AtomicU64::new(0),
            resolved_first: quick()
                .resolve_to_addrs(host, resolved)
                .build()
                .context("failed to build the preferred resolving test client")?,
            tunnel_port: std::sync::atomic::AtomicU16::new(0),
            path_failure_sink: None,
        })
    }

    /// Shared settings. Both clients must agree on everything except how the API
    /// host is resolved; a fallback that also relaxed proxying or redirects would
    /// be a second, weaker channel rather than the same channel resolved
    /// differently.
    fn builder() -> reqwest::ClientBuilder {
        reqwest::Client::builder()
            // The control-plane recovery channel is DNS-pinned and must not
            // silently inherit HTTP(S)_PROXY, ALL_PROXY, or WinINET proxy
            // settings. The OS TUN still carries this socket when connected;
            // this only disables application-layer proxy discovery.
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .cookie_store(false)
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(TOTAL_TIMEOUT)
    }
}

fn method_of(method: HttpMethod) -> reqwest::Method {
    match method {
        HttpMethod::Get => reqwest::Method::GET,
        HttpMethod::Post => reqwest::Method::POST,
        HttpMethod::Delete => reqwest::Method::DELETE,
    }
}

impl TonoTransport {
    /// [`Self::exchange`] on `path`, timed. A transport failure waits for the next attempt of
    /// the same `send`; when one starts, the failure is reported with it as `next_path` (A19).
    /// The last failure of a walk has no successor and is not reported, as on macOS.
    async fn attempt(
        &self,
        client: &reqwest::Client,
        request: &ApiRequest,
        path: AttemptPath,
    ) -> Result<ApiResponse, ApiError> {
        let _ = PENDING_PATH_FAILURE.try_with(|pending| {
            if let (Some((failed, reason, elapsed_ms)), Some(sink)) =
                (pending.take(), self.path_failure_sink.as_ref())
            {
                sink(PathFailure {
                    path: failed.header_value(),
                    next_path: path.header_value(),
                    reason,
                    elapsed_ms,
                });
            }
        });
        let started = tokio::time::Instant::now();
        let result = self.exchange(client, request, path).await;
        if let Err(ApiError::Transport { kind, .. }) = &result {
            let elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
            let _ = PENDING_PATH_FAILURE
                .try_with(|pending| pending.set(Some((path, kind_label(*kind), elapsed_ms))));
        }
        result
    }

    /// One attempt over one client. Shared so the pinned and system-resolved
    /// paths cannot drift in how they read a response.
    async fn exchange(
        &self,
        client: &reqwest::Client,
        request: &ApiRequest,
        path: AttemptPath,
    ) -> Result<ApiResponse, ApiError> {
        let transport = |err: &reqwest::Error| ApiError::Transport {
            kind: classify(err),
            message: describe(err),
        };
        let mut builder = client
            .request(method_of(request.method), &request.url)
            .header("X-Tono-Client", CLIENT_HEADER)
            .header("X-Tono-Path", path.header_value());
        if let Some(bearer) = &request.bearer {
            builder = builder.bearer_auth(bearer);
        }
        if let Some(body) = &request.json_body {
            builder = builder
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(body.clone());
        }
        // Mutually exclusive with `json_body` by construction, so the two cannot
        // both set a content type on one request.
        if let Some(body) = &request.binary_body {
            builder = builder
                .header(reqwest::header::CONTENT_TYPE, body.content_type)
                .body(body.bytes.clone());
        }
        for (name, value) in &request.headers {
            builder = builder.header(name.as_str(), value.as_str());
        }

        let mut response = builder.send().await.map_err(|err| transport(&err))?;
        self.answers.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        let status = response.status().as_u16();
        if response
            .content_length()
            .is_some_and(|length| length as usize > MAX_RESPONSE_BYTES)
        {
            return Err(ApiError::InvalidResponse);
        }
        // Stream the body with a hard cap: a missing or lying Content-Length
        // must not turn into an unbounded read.
        let mut body = Vec::new();
        loop {
            let chunk = match response.chunk().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                // #582: a non-2xx status is the server's answer even when its body
                // is cut off. It goes up as that status, with what arrived, so
                // tono-core classifies it (401/403) or reports it as a server error,
                // never as an unreachable control plane that offline admission accepts.
                Err(_) if !(200..300).contains(&status) => break,
                Err(err) => return Err(transport(&err)),
            };
            if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                return Err(ApiError::InvalidResponse);
            }
            body.extend_from_slice(&chunk);
        }
        Ok(ApiResponse { status, body })
    }
}


/// Connect budget for an alternate-port attempt.
///
/// Deliberately far shorter than the 30 s production connect timeout. An alternate port is a
/// long shot on a network that is already interfering, and some networks *drop* non-standard
/// ports rather than resetting them — walking five of those at 30 s each would turn a failed
/// sign-in into a three-minute hang, which is worse than the error it is trying to avoid.
const ALTERNATE_CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
const ALTERNATE_TOTAL_TIMEOUT: Duration = Duration::from_secs(8);
/// Whole-walk budget, so the per-attempt one cannot be multiplied by the number of ports and
/// then doubled again by the retry in `ApiClient::call`.
const ALTERNATE_WALK_BUDGET: Duration = Duration::from_secs(20);

impl TonoTransport {
    /// Same URL, different TCP port.
    fn with_port(url: &str, port: u16) -> Option<String> {
        let mut parsed = reqwest::Url::parse(url).ok()?;
        parsed.set_port(Some(port)).ok()?;
        Some(parsed.to_string())
    }

    /// A client pinned to the control-plane addresses at `port`.
    ///
    /// The pins carry the port and the URL carries the same one, so there is no dependence on
    /// how the HTTP client treats a port inside a DNS override. Everything else — no proxy, no
    /// redirects, full certificate validation against the same hostname — is the shared
    /// builder, so this is the same channel on a different port rather than a weaker one.
    fn alternate_client(port: u16) -> Result<reqwest::Client> {
        let pinned: Vec<std::net::SocketAddr> = bootstrap::control_plane_http_pins()
            .into_iter()
            .map(|ip| std::net::SocketAddr::new(std::net::IpAddr::V4(ip), port))
            .collect();
        Self::builder()
            .connect_timeout(ALTERNATE_CONNECT_TIMEOUT)
            .timeout(ALTERNATE_TOTAL_TIMEOUT)
            .resolve_to_addrs(bootstrap::API_HOST, &pinned)
            .build()
            .context("failed to build the alternate-port Tono HTTP client")
    }

    /// Walk the alternate HTTPS ports, most-recently-successful first.
    ///
    /// One attempt on one alternate port, with the delivery judgement the rest of this file
    /// makes.
    ///
    /// Returns `Some` when the caller must stop — either it worked, or it failed in a way that
    /// may already have put the request on the wire. `None` means "provably not delivered,
    /// safe to try the next port".
    ///
    /// This is the part the first version got wrong: it walked every port looking only at
    /// `Ok`, so a TLS failure or a timeout on port 2053 — both of which can mean the server
    /// already has the bytes — moved straight on to 2083 and sent the body again. For the
    /// route this was built for that is a sign-in code submitted twice, and for `DELETE` a
    /// device removed twice. `should_retry_transport` exists to make exactly this call and was
    /// consulted once before the walk instead of once per attempt.
    async fn attempt_one_alternate(
        &self,
        request: &ApiRequest,
        port: u16,
    ) -> Option<Result<ApiResponse, ApiError>> {
        let url = Self::with_port(&request.url, port)?;
        let client = Self::alternate_client(port).ok()?;
        let attempt = ApiRequest {
            url,
            ..request.clone()
        };
        match self.attempt(&client, &attempt, AttemptPath::AltPort).await {
            Ok(response) => {
                self.alternate_port
                    .store(port, std::sync::atomic::Ordering::Relaxed);
                Some(Ok(response))
            }
            Err(ApiError::Transport { kind, message }) => {
                if should_retry_transport(request.method, kind) {
                    None
                } else {
                    Some(Err(ApiError::Transport { kind, message }))
                }
            }
            // A non-transport error is a real answer from the server: it arrived.
            Err(other) => Some(Err(other)),
        }
    }

    /// Walk the alternate HTTPS ports.
    ///
    /// Bounded in total, not just per attempt. Five ports on a network that *drops* rather than
    /// resets would otherwise cost five connect timeouts, and `ApiClient::call` retries the
    /// whole thing once — the three-minute hang the per-attempt budget was chosen to avoid,
    /// reached by a different route.
    async fn attempt_alternate_ports(
        &self,
        request: &ApiRequest,
    ) -> Option<Result<ApiResponse, ApiError>> {
        use std::sync::atomic::Ordering;
        let remembered = self.alternate_port.load(Ordering::Relaxed);
        let ports = tono_service_protocol::CONTROL_PLANE_PORTS;
        let mut order: Vec<u16> = Vec::with_capacity(ports.len());
        if remembered != 0 && remembered != 443 {
            order.push(remembered);
        }
        // 443 is the port that already failed on this request; skip it here.
        order.extend(
            ports
                .iter()
                .copied()
                .filter(|port| *port != 443 && *port != remembered),
        );

        let deadline = tokio::time::Instant::now() + ALTERNATE_WALK_BUDGET;
        for port in order {
            if tokio::time::Instant::now() >= deadline {
                break;
            }
            if let Some(result) = self.attempt_one_alternate(request, port).await {
                return Some(result);
            }
        }
        // Every alternate failed too. Forget any remembered port so the next call starts from
        // 443 again rather than paying for a port that has stopped working.
        self.alternate_port.store(0, Ordering::Relaxed);
        None
    }

    /// One attempt through relay `index`, with the delivery judgement the rest of this
    /// file makes.
    ///
    /// `Ok` carries a result the caller must return: a response, a server answer, or a
    /// failure that may already have put the request on the wire. `Err` carries the
    /// failure text of an attempt that provably delivered nothing, so the walk may go on.
    ///
    /// The URL carries the relay's port and the pin carries the same one, as the alternate
    /// ports do; the SNI is the hostname alone, and the Cloudflare edge the relay forwards to
    /// ignores the port in `Host` (measured 2026-09-29 and again through the relay 2026-10-10).
    async fn attempt_one_relay(
        &self,
        request: &ApiRequest,
        index: usize,
    ) -> Result<Result<ApiResponse, ApiError>, String> {
        use std::sync::atomic::Ordering;
        let Some(relay) = self.relays.get(index) else {
            return Err("no such relay".to_owned());
        };
        let Some(url) = Self::with_port(&request.url, relay.address.port()) else {
            return Err(format!("relay {}: unusable url", relay.address));
        };
        let attempt = ApiRequest {
            url,
            ..request.clone()
        };
        match self.attempt(&relay.client, &attempt, AttemptPath::Relay).await {
            Ok(response) => {
                self.preferred_relay.store(index + 1, Ordering::Relaxed);
                Ok(Ok(response))
            }
            Err(ApiError::Transport { kind, message }) => {
                if should_retry_transport(request.method, kind) {
                    Err(format!("{}: {message}", relay.address))
                } else {
                    Ok(Err(ApiError::Transport { kind, message }))
                }
            }
            // A non-transport error is a real answer from the server: it arrived.
            Err(other) => Ok(Err(other)),
        }
    }

    /// Walk the compiled relays in order. `note` collects the text of every provably
    /// undelivered failure for the combined error message, so a support report shows
    /// that the relay was tried and how it failed.
    async fn attempt_relays(
        &self,
        request: &ApiRequest,
        note: &mut String,
    ) -> Option<Result<ApiResponse, ApiError>> {
        for index in 0..self.relays.len() {
            match self.attempt_one_relay(request, index).await {
                Ok(result) => return Some(result),
                Err(failure) => {
                    if !note.is_empty() {
                        note.push_str("; ");
                    }
                    note.push_str(&failure);
                }
            }
        }
        None
    }

    /// DNS-over-HTTPS raced across pinned resolvers. System DNS is not
    /// read or written. A poisoned answer that is not a public IPv4 is ignored.
    async fn attempt_doh(&self, request: &ApiRequest) -> Option<Result<ApiResponse, ApiError>> {
        if !request.url.contains(bootstrap::API_HOST) {
            return None;
        }
        tokio::time::sleep(tono_core::backoff_before(2)).await;
        let ips = resolve_via_doh(bootstrap::API_HOST).await.ok()?;
        if ips.is_empty() {
            return None;
        }
        let pinned: Vec<std::net::SocketAddr> = ips
            .into_iter()
            .map(|ip| std::net::SocketAddr::new(std::net::IpAddr::V4(ip), 443))
            .collect();
        let client = Self::builder()
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(8))
            .resolve_to_addrs(bootstrap::API_HOST, &pinned)
            .build()
            .ok()?;
        match self.attempt(&client, request, AttemptPath::Doh).await {
            Ok(response) => Some(Ok(response)),
            Err(ApiError::Transport { kind, .. }) if should_retry_transport(request.method, kind) => {
                None
            }
            Err(other) => Some(Err(other)),
        }
    }

    /// Last resort through an already-running loopback proxy. HTTPS CONNECT failures
    /// surface as transport errors; a response after TLS belongs to the API, including 5xx.
    async fn attempt_tunnel(&self, request: &ApiRequest) -> Option<Result<ApiResponse, ApiError>> {
        let port = self.tunnel_port.load(std::sync::atomic::Ordering::Relaxed);
        if port == 0 {
            return None;
        }
        tokio::time::sleep(tono_core::backoff_before(4)).await;
        let proxy = reqwest::Proxy::all(format!("http://127.0.0.1:{port}")).ok()?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .proxy(proxy)
            .redirect(reqwest::redirect::Policy::none())
            .cookie_store(false)
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(8))
            .build()
            .ok()?;
        self.attempt_tunnel_response(&client, request).await
    }

    async fn attempt_tunnel_response(
        &self, client: &reqwest::Client, request: &ApiRequest,
    ) -> Option<Result<ApiResponse, ApiError>> {
        match self.attempt(client, request, AttemptPath::Tunnel).await {
            Ok(response) => Some(Ok(response)),
            Err(ApiError::Transport { kind, .. }) if should_retry_transport(request.method, kind) => {
                None
            }
            Err(other) => Some(Err(other)),
        }
    }
}

async fn resolve_via_doh(name: &str) -> Result<Vec<std::net::Ipv4Addr>, ()> {
    let resolvers = tono_core::doh_resolvers();
    let (tx, mut rx) = tokio::sync::mpsc::channel(resolvers.len());
    for resolver in resolvers {
        let tx = tx.clone();
        let name = name.to_owned();
        let host = resolver.host;
        let pins = resolver.ipv4.to_vec();
        tokio::spawn(async move {
            let answer = query_one_doh(host, &pins, &name).await.ok();
            let _ = tx.send(answer).await;
        });
    }
    drop(tx);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    let mut seen = Vec::with_capacity(resolvers.len());
    while seen.len() < resolvers.len() {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, rx.recv()).await {
            Ok(Some(answer)) => {
                seen.push(answer);
                if let Some(ips) = tono_core::first_public_doh_answer(&seen) {
                    return Ok(ips);
                }
            }
            _ => break,
        }
    }
    Err(())
}

async fn query_one_doh(
    host: &'static str,
    pins: &[std::net::Ipv4Addr],
    name: &str,
) -> Result<Vec<std::net::Ipv4Addr>, ()> {
    let addrs: Vec<std::net::SocketAddr> = pins
        .iter()
        .copied()
        .map(|ip| std::net::SocketAddr::new(std::net::IpAddr::V4(ip), 443))
        .collect();
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(2))
        .resolve_to_addrs(host, &addrs)
        .build()
        .map_err(|_| ())?;
    let url = format!("https://{host}/dns-query?name={name}&type=A");
    let body = client
        .get(url)
        .header("accept", "application/dns-json")
        .send()
        .await
        .map_err(|_| ())?
        .text()
        .await
        .map_err(|_| ())?;
    let ips = tono_core::parse_doh_json_answers(&body);
    if ips.is_empty() { Err(()) } else { Ok(ips) }
}

#[async_trait]
impl HttpTransport for TonoTransport {
    /// Every path below, then H21-O-F8's attribution of the outcome: a refused certificate
    /// or an OS-reported captive portal is named in the error's support code and kept for the
    /// diagnostics report. The OS verdict is read only after a transport failure and is not a
    /// probe; the kind, and so the retry and offline-admission rules, are unchanged.
    async fn send(&self, request: ApiRequest) -> Result<ApiResponse, ApiError> {
        // A19: each request's path failures wait for their successor within this `send` only.
        let result = PENDING_PATH_FAILURE
            .scope(std::cell::Cell::new(None), self.send_over_paths(request))
            .await;
        let captive = tono_core::network_interference::wants_os_signal(&result)
            && crate::tono::network_interference::os_reports_captive_portal().await;
        let (result, observation) = tono_core::network_interference::attribute(result, captive);
        crate::tono::network_interference::record(observation);
        result
    }
}

impl TonoTransport {
    async fn send_over_paths(&self, request: ApiRequest) -> Result<ApiResponse, ApiError> {
        crate::tono::integration_profile::delay_remote_operation().await;

        // A port that already worked goes first, ahead of the two 443 attempts.
        //
        // The first version stored it and then still tried 443 twice on every later request,
        // which is the opposite of what remembering it was for: on a network that *drops* 443
        // rather than resetting it, that is two connect timeouts before every single call. The
        // comment on the field claimed this behaviour; the code did not have it.
        //
        // If the remembered port has since stopped working, `attempt_one_alternate` clears it
        // on a provably-undelivered failure and the normal 443 paths below run as usual, so a
        // network that recovers is not stuck here.
        let remembered = self
            .alternate_port
            .load(std::sync::atomic::Ordering::Relaxed);
        if remembered != 0 {
            match self.attempt_one_alternate(&request, remembered).await {
                Some(result) => return result,
                // Provably not delivered, so this port has stopped working. Forget it before
                // falling through, or every later request pays for it first.
                None => self
                    .alternate_port
                    .store(0, std::sync::atomic::Ordering::Relaxed),
            }
        }

        // A relay that already answered goes first for the same reason: for the customer it
        // exists for, every Cloudflare path drops, and paying the pinned and resolved connect
        // budgets before every request would make the app unusable rather than merely slow.
        // Its failure text joins the combined message below when nothing else answers.
        let mut relay_note = String::new();
        let preferred_relay = self
            .preferred_relay
            .load(std::sync::atomic::Ordering::Relaxed);
        if preferred_relay != 0 {
            match self.attempt_one_relay(&request, preferred_relay - 1).await {
                Ok(result) => return result,
                // Provably not delivered: forget it, so the pins run as usual below.
                Err(failure) => {
                    self.preferred_relay
                        .store(0, std::sync::atomic::Ordering::Relaxed);
                    relay_note = failure;
                }
            }
        }

        // The resolved client goes first once it has answered in place of dead pins (#583). Its
        // failure moves on to the pins only when it proves nothing was delivered. Any failure or
        // cancellation clears the preference (`PreferenceLease`).
        let mut resolved_failed = None;
        if self.prefer_resolved.load(std::sync::atomic::Ordering::Relaxed) {
            let mut lease = PreferenceLease { flag: &self.prefer_resolved, answered: false };
            match self.attempt(&self.resolved_first, &request, AttemptPath::SystemDns).await {
                Err(ApiError::Transport { kind, message })
                    if should_retry_transport(request.method, kind) =>
                {
                    resolved_failed = Some(ApiError::Transport { kind, message });
                }
                // May already have been delivered: never re-sent to the pins.
                Err(error @ ApiError::Transport { .. }) => return Err(error),
                result => {
                    lease.answered = true;
                    return result;
                }
            }
        }

        let pinned = {
            // Each attempt keeps its own pool/pin snapshot. Publishing fresh pins must not
            // wait for a slow response, nor cancel or replay an already delivered request.
            let client = self.client.read().await.clone();
            self.attempt(&client, &request, AttemptPath::Pinned).await
        };
        let Err(ApiError::Transport { kind, message }) = pinned else {
            return pinned;
        };
        // The fallback obeys the same rule as the retry policy rather than a
        // looser one of its own: a POST or DELETE is re-sent only when the
        // failure proves the request never reached the server. A timeout or a
        // TLS failure may already have delivered the bytes, and re-sending a
        // login code or a device deletion in that state is worse than failing.
        if !should_retry_transport(request.method, kind) {
            return Err(ApiError::Transport { kind, message });
        }
        let fallback = match resolved_failed {
            // Already tried for this request, just before the pins.
            Some(failure) => Err(failure),
            None => self.attempt(&self.resolved, &request, AttemptPath::SystemDns).await,
        };
        match fallback {
            Ok(response) => {
                self.prefer_resolved
                    .store(true, std::sync::atomic::Ordering::Relaxed);
                Ok(response)
            }
            // Both paths are named. Which one failed and how is the whole
            // diagnostic: "pinned addresses unreachable, system DNS fine" and
            // "nothing reachable at all" call for completely different actions,
            // and a single merged message cannot tell them apart.
            Err(ApiError::Transport {
                kind: fallback_kind,
                message: fallback_message,
            }) => {
                // Both paths carry the same hostname and therefore the same TLS SNI, so when
                // both fail identically the address is not what is being refused. Trying the
                // same server on a port an SNI blocklist is unlikely to be keyed on is the one
                // route around that which needs no server change — Cloudflare answers the same
                // zone, with the same certificate, on all of these.
                if should_retry_transport(request.method, fallback_kind) {
                    // The Tono relays, then DoH, then the other direct ports, then a
                    // tunnel that is already up. Each step is skipped when it cannot
                    // run. A delivered response stops the walk. Nothing here changes
                    // system DNS, routes, or filters.
                    //
                    // The relays come first because every later step still lands on
                    // Cloudflare: DoH resolves to its anycast and the alternate ports
                    // are its ports, and the customer this exists for cannot reach
                    // Cloudflare on any of them.
                    if let Some(result) = self.attempt_relays(&request, &mut relay_note).await {
                        return result;
                    }
                    if let Some(result) = self.attempt_doh(&request).await {
                        return result;
                    }
                    if let Some(result) = self.attempt_alternate_ports(&request).await {
                        return result;
                    }
                    if let Some(result) = self.attempt_tunnel(&request).await {
                        return result;
                    }
                }
                let relay_part = if relay_note.is_empty() {
                    String::new()
                } else {
                    format!("; relay[{relay_note}]")
                };
                Err(ApiError::Transport {
                    kind: fallback_kind,
                    message: format!(
                        "pinned[{message}]; system-dns[{fallback_message}]{relay_part}"
                    ),
                })
            }
            Err(other) => Err(other),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CONNECT_TIMEOUT, Duration, MAX_RESPONSE_BYTES, TOTAL_TIMEOUT, TonoTransport, describe,
        kind_label, method_of,
    };
    use tono_core::auth::{
        ApiError, ApiRequest, ApiResponse, HttpMethod, HttpTransport, TransportKind,
        should_retry_transport,
    };


    /// A successful HTTPS CONNECT carries a TLS-authenticated origin response, including 5xx.
    #[tokio::test]
    async fn a_tunneled_server_error_keeps_its_status_and_answer_evidence() {
        use std::sync::Arc;
        use rustls::pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject as _};
        use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

        // Public, self-signed localhost fixture; explicitly trusted only by this test client.
        const CERT: &[u8] = br#"-----BEGIN CERTIFICATE-----
MIIBkjCCATigAwIBAgIUbrR/uEngND/q3kEU4UZPL7whowIwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTAwMTA2MTE0NFoYDzIxMjYwOTA3
MDYxMTQ0WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAATwJUx0VKbCsLuPMCMDfumu5NkY8T0YQs5+2gzS+WTLmkUi3DGTLOM5
MNkGJLQmYawD5NeOSSgCtMv3Jk59yqgBo2YwZDAdBgNVHQ4EFgQU63iNGtUXjrwT
6HwTEHqn5gWpBmcwHwYDVR0jBBgwFoAU63iNGtUXjrwT6HwTEHqn5gWpBmcwFAYD
VR0RBA0wC4IJbG9jYWxob3N0MAwGA1UdEwEB/wQCMAAwCgYIKoZIzj0EAwIDSAAw
RQIgCsPAdoC0Rg8T3GlV1TAURVMVeklDILtiylJCvqr6r4cCIQC8LCBljlLce+un
KKXlMCmoSInGBUpy3EBDjYAVZY8Inw==
-----END CERTIFICATE-----
"#;
        const KEY: &[u8] = br#"-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgSFr9xgWbx9S9/uVA
Ok+kFhTGRkDmYZ/UtQdExIb+X9ihRANCAATwJUx0VKbCsLuPMCMDfumu5NkY8T0Y
Qs5+2gzS+WTLmkUi3DGTLOM5MNkGJLQmYawD5NeOSSgCtMv3Jk59yqgB
-----END PRIVATE KEY-----
"#;
        let server_config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
            .with_safe_default_protocol_versions().unwrap()
            .with_no_client_auth()
            .with_single_cert(
                vec![CertificateDer::from_pem_slice(CERT).unwrap()],
                PrivateKeyDer::from_pem_slice(KEY).unwrap(),
            ).unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(server_config));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy_address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut connect = Vec::new();
            while !connect.ends_with(b"\r\n\r\n") {
                connect.push(stream.read_u8().await.unwrap());
                assert!(connect.len() < 4096);
            }
            assert!(connect.starts_with(b"CONNECT localhost:443 HTTP/1.1\r\n"));
            stream.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n").await.unwrap();
            let mut tls = acceptor.accept(stream).await.unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                request.push(tls.read_u8().await.unwrap());
                assert!(request.len() < 4096);
            }
            tls.write_all(
                b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 4\r\nConnection: close\r\n\r\nbusy",
            ).await.unwrap();
            tls.shutdown().await.unwrap();
        });
        let transport = TonoTransport::new().unwrap();
        let client = TonoTransport::builder()
            .proxy(reqwest::Proxy::all(format!("http://{proxy_address}")).unwrap())
            .tls_certs_only([reqwest::Certificate::from_pem(CERT).unwrap()])
            .build().unwrap();
        let request = ApiRequest {
            method: HttpMethod::Get,
            url: "https://localhost/api/v1/me".into(),
            bearer: None,
            json_body: None,
            binary_body: None,
            headers: Vec::new(),
        };
        let response = tokio::time::timeout(
            Duration::from_secs(5), transport.attempt_tunnel_response(&client, &request),
        ).await.unwrap();
        server.await.unwrap();
        let response = response.expect("an origin 503 must end the fallback walk").unwrap();
        assert_eq!(response.status, 503);
        assert_eq!(response.body, b"busy");
        assert_eq!(transport.answers_seen(), 1, "the origin did answer");
    }

    /// A pending response owns a client snapshot, not the lock used to publish new pins.
    #[tokio::test]
    async fn pin_refresh_finishes_before_an_in_flight_http_response() {
        use std::sync::Arc;
        use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let transport = Arc::new(TonoTransport::new().unwrap());
        let request = tokio::spawn({
            let transport = Arc::clone(&transport);
            async move {
                transport.send(ApiRequest {
                    method: HttpMethod::Get,
                    url: format!("http://{address}/"),
                    bearer: None,
                    json_body: None,
                    binary_body: None,
                    headers: Vec::new(),
                }).await
            }
        });
        let mut stream = tokio::time::timeout(Duration::from_secs(2), async {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut header = Vec::new();
            while !header.ends_with(b"\r\n\r\n") {
                header.push(stream.read_u8().await.unwrap());
                assert!(header.len() < 4096);
            }
            stream
        }).await.expect("the real HTTP attempt must reach the fixture");
        assert!(!request.is_finished(), "the fixture has not sent a response");

        tokio::time::timeout(Duration::from_secs(2), transport.refresh_control_plane_pins())
            .await
            .expect("pin publication must not wait for unrelated HTTP I/O")
            .expect("rebuild pinned client");
        assert!(!request.is_finished(), "refresh must not cancel the old request");
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nhi")
            .await.unwrap();
        let response = tokio::time::timeout(Duration::from_secs(2), request)
            .await.unwrap().unwrap().unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.body, b"hi");
    }

    /// #582: a 401 whose body is cut off is still the server's answer, so it
    /// reaches tono-core's classifier as a status, not as a transport failure.
    #[tokio::test]
    async fn a_refusal_whose_body_is_cut_off_is_still_an_answer() {
        use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut header = Vec::new();
            while !header.ends_with(b"\r\n\r\n") {
                let Ok(byte) = stream.read_u8().await else { return };
                header.push(byte);
            }
            // Promise more body than is sent, then close mid-body.
            let _ = stream
                .write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 64\r\nConnection: close\r\n\r\n{\"error\"")
                .await;
            let _ = stream.shutdown().await;
        });
        let transport = TonoTransport::new().unwrap();
        let client = TonoTransport::builder().build().unwrap();
        let request = ApiRequest {
            method: HttpMethod::Get,
            url: format!("http://{address}/"),
            bearer: None,
            json_body: None,
            binary_body: None,
            headers: Vec::new(),
        };
        let response = tokio::time::timeout(Duration::from_secs(5), transport.attempt(&client, &request, super::AttemptPath::Pinned))
            .await
            .expect("the fixture answers at once")
            .expect("a cut-off 401 is the server's answer, not a transport failure");
        assert_eq!(response.status, 401);
    }

    /// Whether something in the network path accepts a connection to an address
    /// that must not be reachable.
    ///
    /// Both tests below rest on one premise: packets to a blackholed RFC1918
    /// address are dropped, so the connect runs out of time and reqwest reports
    /// a connect-phase failure. A TUN VPN — including this product's own —
    /// completes that connect locally and instantly, and the failure then
    /// arrives later as a response timeout with `is_connect()` false. The
    /// premise is gone, so the assertions below say nothing, and a developer
    /// running the suite while connected would be told reqwest had changed its
    /// error flags. CI runners have no tunnel, which is where these must run.
    fn blackhole_is_intercepted() -> bool {
        std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([10, 255, 255, 1], 80)),
            std::time::Duration::from_millis(300),
        )
        .is_ok()
    }

    /// A connect that timed out must be classified as never-delivered.
    ///
    /// reqwest sets both flags for it, so the ordering inside `classify` decides
    /// whether a POST may be re-sent. Packets to a blocked address are dropped
    /// rather than refused, which is precisely the case where a user is stuck on
    /// the sign-in screen — and signing in is a POST.
    #[tokio::test]
    async fn a_connect_that_times_out_is_not_an_ambiguous_timeout() {
        if blackhole_is_intercepted() {
            eprintln!(
                "skipped: a tunnel is completing the blackhole connect, so the \
                 connect phase cannot fail here; run without a VPN, as CI does"
            );
            return;
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(std::time::Duration::from_millis(700))
            .build()
            .expect("client");
        // Unroutable RFC1918 address: packets are dropped, so the connect runs
        // out of time instead of being refused.
        let blackholed = client
            .get("http://10.255.255.1/")
            .send()
            .await
            .expect_err("an unroutable address must fail");
        assert!(
            blackholed.is_timeout() && blackholed.is_connect(),
            "reqwest changed which flags it sets; the ordering in classify depends on this"
        );
        assert_eq!(
            super::classify(&blackholed),
            TransportKind::Connect,
            "a connect-phase timeout delivered nothing and must be retryable"
        );
        assert!(
            should_retry_transport(HttpMethod::Post, super::classify(&blackholed)),
            "a blocked address must not strand a POST"
        );

        let refused = client
            .get("http://127.0.0.1:1/")
            .send()
            .await
            .expect_err("a closed port must fail");
        assert_eq!(super::classify(&refused), TransportKind::Connect);
    }

    /// Every classification has a distinct word. A label that collided would put
    /// two different faults under one name in every report.
    #[test]
    fn each_transport_kind_has_its_own_label() {
        let kinds = [
            TransportKind::Dns,
            TransportKind::Connect,
            TransportKind::Tls,
            TransportKind::Timeout,
            TransportKind::Other,
        ];
        let labels: Vec<&str> = kinds.iter().copied().map(kind_label).collect();
        let mut unique = labels.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), labels.len(), "{labels:?}");
    }

    /// The reported message must say more than reqwest's own sentence.
    ///
    /// `error sending request for url (...)` is identical whether the name did not
    /// resolve, the connection was refused, or the certificate failed — a report
    /// containing only that cannot be acted on, and one such report cost a full
    /// round of guessing before this existed.
    #[tokio::test]
    async fn the_message_names_the_phase_and_the_underlying_cause() {
        let client = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(std::time::Duration::from_secs(5))
            .build()
            .expect("client");
        // A port nothing listens on: a connect failure with a real source chain.
        let err = client
            .get("http://127.0.0.1:1/")
            .send()
            .await
            .expect_err("a closed port must fail");
        let described = describe(&err);
        assert!(
            described.starts_with("connect: "),
            "the phase must lead the message: {described}"
        );
        assert!(
            described.len() > err.to_string().len(),
            "nothing was added to reqwest's own text: {described}"
        );
        assert!(
            described.contains(" <- "),
            "the source chain was dropped: {described}"
        );
    }

    /// The point of the change: pinned addresses that cannot be reached no longer
    /// end the attempt. Before this, `resolve_to_addrs` was the only resolution
    /// path, so two unreachable addresses meant a client that could never sign in
    /// while the same machine's browser worked.
    #[tokio::test]
    async fn an_unreachable_pinned_address_falls_back_to_the_system_resolver() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        // Serves every connection, not one: an earlier version stopped after the
        // first, and the pinned attempt consumed it — the fallback then saw
        // "connection refused" and the test blamed the code for its own setup.
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                use std::io::{BufRead as _, BufReader, Write as _};
                let Ok(mut stream) = stream else { continue };
                // The request is read to its blank line before anything is
                // written. Replying immediately and dropping the socket resets the
                // connection while the client is still sending, which reqwest
                // reports as a cancelled request — the earlier version of this
                // test did that and failed roughly one run in three, which reads
                // as a flaky fallback rather than a flaky fixture.
                let mut reader = BufReader::new(match stream.try_clone() {
                    Ok(clone) => clone,
                    Err(_) => continue,
                });
                let mut line = String::new();
                while reader.read_line(&mut line).unwrap_or(0) > 0 {
                    if line == "\r\n" || line == "\n" {
                        break;
                    }
                    line.clear();
                }
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nhi",
                );
                let _ = stream.flush();
                let _ = stream.shutdown(std::net::Shutdown::Write);
            }
        });

        // An unroutable RFC1918 address: packets are dropped, so the pinned
        // attempt times out during connect. That is the field case — a blocked
        // address drops rather than refuses — and it reaches the fallback only
        // because `classify` files a connect-phase timeout as never-delivered.
        let dead = vec![std::net::SocketAddr::from(([10, 255, 255, 1], 443))];
        let live = vec![std::net::SocketAddr::from(([127, 0, 0, 1], port))];
        // A hostname, not an IP literal: `resolve_to_addrs` overrides name
        // resolution and is not consulted for a literal address at all. Three
        // earlier versions of this test pinned a literal and passed while the
        // override did nothing — one of them passed with the fallback removed.
        let url = format!("http://tono-fallback.test:{port}/");

        // Proven, not assumed: a client restricted to the pinned address cannot
        // reach this server.
        let pinned_only = TonoTransport::builder()
            .connect_timeout(Duration::from_millis(700))
            .resolve_to_addrs("tono-fallback.test", &dead)
            .build()
            .expect("pinned-only client");
        pinned_only
            .get(&url)
            .send()
            .await
            .expect_err("the pinned address must be unreachable for this test to mean anything");

        let transport =
            TonoTransport::with_clients("tono-fallback.test", &dead, &live).expect("transport");
        let response: ApiResponse = transport
            .send(ApiRequest {
                method: HttpMethod::Get,
                url: url.clone(),
                bearer: None,
                json_body: None,
                binary_body: None,
                headers: Vec::new(),
            })
            .await
            .expect("the fallback must carry the request");
        assert_eq!(response.status, 200);
        assert_eq!(response.body, b"hi");
    }

    /// A19: a path that fails undelivered before the next one runs is reported with that next
    /// path, its failure class and its time, and with nothing else (the macOS
    /// `control_plane_path_failed`). The audit line is what the periodic timeline uploads.
    #[tokio::test]
    async fn a_failed_path_is_reported_with_the_next_path_and_its_time() {
        // Refused at once: a port that was just free on loopback.
        let closed = std::net::TcpListener::bind("127.0.0.1:0").expect("bind").local_addr().expect("addr");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                use std::io::{BufRead as _, BufReader, Write as _};
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(match stream.try_clone() {
                    Ok(clone) => clone,
                    Err(_) => continue,
                });
                let mut line = String::new();
                while reader.read_line(&mut line).unwrap_or(0) > 0 {
                    if line == "\r\n" || line == "\n" {
                        break;
                    }
                    line.clear();
                }
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nhi");
                let _ = stream.flush();
                let _ = stream.shutdown(std::net::Shutdown::Write);
            }
        });
        let (failures_tx, failures_rx) = std::sync::mpsc::channel();
        let transport = TonoTransport::with_clients(
            "tono-path-event.test",
            &[closed],
            &[std::net::SocketAddr::from(([127, 0, 0, 1], port))],
        )
        .expect("transport")
        .with_path_failure_sink(Box::new(move |failure| {
            let _ = failures_tx.send(failure);
        }));
        let response = transport
            .send(ApiRequest {
                method: HttpMethod::Get,
                url: format!("http://tono-path-event.test:{port}/"),
                bearer: None,
                json_body: None,
                binary_body: None,
                headers: Vec::new(),
            })
            .await
            .expect("the system resolver answers");
        assert_eq!(response.status, 200);

        let failures: Vec<super::PathFailure> = failures_rx.try_iter().collect();
        assert_eq!(failures.len(), 1, "{failures:?}");
        let failure = failures[0];
        assert_eq!((failure.path, failure.next_path, failure.reason), ("pinned", "system_dns", "connect"));
        assert!(failure.elapsed_ms < 5_000, "{failure:?}");
        let line = serde_json::to_value(crate::tono::audit::AuditEvent::ControlPlanePathFail {
            from: failure.path,
            to: failure.next_path,
            reason: failure.reason,
            elapsed_ms: failure.elapsed_ms,
        })
        .expect("serialize");
        assert_eq!(
            line,
            serde_json::json!({
                "kind": "controlPlanePathFail",
                "from": "pinned",
                "to": "system_dns",
                "reason": "connect",
                "elapsedMs": failure.elapsed_ms,
            })
        );
    }

    /// Decision 077: when the pinned addresses and the system resolver both fail provably
    /// undelivered, the request goes through a Tono relay, its answer stands, and later
    /// requests go to that relay first.
    #[tokio::test]
    async fn dead_cloudflare_paths_fall_back_to_a_relay() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        // The `X-Tono-Path` value of every request the relay received, `None` when absent.
        let (paths_tx, paths_rx) = std::sync::mpsc::channel::<Option<String>>();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                use std::io::{BufRead as _, BufReader, Write as _};
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(match stream.try_clone() {
                    Ok(clone) => clone,
                    Err(_) => continue,
                });
                let mut line = String::new();
                let mut path = None;
                while reader.read_line(&mut line).unwrap_or(0) > 0 {
                    if line == "\r\n" || line == "\n" {
                        break;
                    }
                    if let Some((name, value)) = line.split_once(':')
                        && name.eq_ignore_ascii_case("x-tono-path")
                    {
                        path = Some(value.trim().to_owned());
                    }
                    line.clear();
                }
                let _ = paths_tx.send(path);
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nrelay",
                );
                let _ = stream.flush();
                let _ = stream.shutdown(std::net::Shutdown::Write);
            }
        });

        // Both Cloudflare paths drop packets; only the relay listens.
        let dead = vec![std::net::SocketAddr::from(([10, 255, 255, 1], 443))];
        let relay = vec![std::net::SocketAddr::from(([127, 0, 0, 1], port))];
        let transport =
            TonoTransport::with_clients_and_relays("tono-relay.test", &dead, &dead, &relay)
                .expect("transport");
        let request = ApiRequest {
            // A POST: the relay must be reached by the retry rule for undelivered requests,
            // which is the one the sign-in code submission depends on.
            method: HttpMethod::Post,
            url: format!("http://tono-relay.test:{port}/api/v1/auth/email/start"),
            bearer: None,
            json_body: Some("{}".to_string()),
            binary_body: None,
            headers: Vec::new(),
        };
        let response = transport
            .send(request.clone())
            .await
            .expect("the relay must carry the request");
        assert_eq!(response.status, 200);
        assert_eq!(response.body, b"relay");
        assert_eq!(
            paths_rx.recv_timeout(Duration::from_secs(1)).expect("the relay saw the request"),
            Some("relay".to_owned()),
            "a relayed attempt must name its path, so the control plane does not take the relay for the device"
        );
        assert_eq!(
            transport.preferred_relay.load(std::sync::atomic::Ordering::Relaxed),
            1,
            "the relay that answered is remembered for the next request"
        );
        // The second request must not pay the dead pins again: well under one pinned
        // connect budget (700 ms in this fixture) is proof it went to the relay first.
        let started = std::time::Instant::now();
        let again = transport.send(request).await.expect("preferred relay");
        assert_eq!(again.status, 200);
        assert!(
            started.elapsed() < Duration::from_millis(500),
            "second request took {:?}, so it paid a dead path first",
            started.elapsed()
        );
    }

    /// #583: launch restore's own sequence, a token refresh (POST) and then `me` (GET), through
    /// clients built exactly as in production with the pinned addresses dropped. Only the first
    /// request may pay the pinned connect budget; the pair must leave the fallbacks more than
    /// half of the restore budget. Before, each request waited out the pins again.
    #[tokio::test]
    async fn restores_refresh_and_me_pay_the_dropped_pins_once() {
        use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
        use tono_core::credentials::{CredentialStore as _, MemoryCredentialStore};
        if blackhole_is_intercepted() {
            eprintln!("skipped: a tunnel is completing the blackhole connect; run without a VPN, as CI does");
            return;
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut header = Vec::new();
                    while !header.ends_with(b"\r\n\r\n") {
                        let Ok(byte) = stream.read_u8().await else { return };
                        header.push(byte);
                    }
                    // Drain the body so closing the socket cannot reset the reply.
                    let head = String::from_utf8_lossy(&header).to_ascii_lowercase();
                    let length = head
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .and_then(|value| value.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    let mut body = vec![0; length];
                    if stream.read_exact(&mut body).await.is_err() {
                        return;
                    }
                    let json = if head.contains("auth/refresh") {
                        r#"{"accessToken":"access-2","refreshToken":"refresh-2"}"#
                    } else {
                        r#"{"user":{"id":"u1","email":"user@example.com"}}"#
                    };
                    let reply = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{json}",
                        json.len()
                    );
                    let _ = stream.write_all(reply.as_bytes()).await;
                    let _ = stream.shutdown().await;
                });
            }
        });
        // `localhost` because the API client admits plain http only for loopback names.
        let host = "localhost";
        let dead = [std::net::SocketAddr::from(([10, 255, 255, 1], port))];
        let live = [std::net::SocketAddr::from(([127, 0, 0, 1], port))];
        let transport = TonoTransport {
            client: tokio::sync::RwLock::new(
                TonoTransport::pinned_builder().resolve_to_addrs(host, &dead).build().unwrap(),
            ),
            resolved: TonoTransport::builder().resolve_to_addrs(host, &live).build().unwrap(),
            alternate_port: std::sync::atomic::AtomicU16::new(0),
            prefer_resolved: std::sync::atomic::AtomicBool::new(false),
            answers: std::sync::atomic::AtomicU64::new(0),
            resolved_first: TonoTransport::pinned_builder().resolve_to_addrs(host, &live).build().unwrap(),
            tunnel_port: std::sync::atomic::AtomicU16::new(0),
            relays: Vec::new(),
            preferred_relay: std::sync::atomic::AtomicUsize::new(0),
        };
        let store = std::sync::Arc::new(MemoryCredentialStore::new());
        store.set_refresh_token("refresh-1").unwrap();
        let client = tono_core::auth::ApiClient::new(&format!("http://{host}:{port}"), transport, store)
            .expect("loopback base URL");

        let started = std::time::Instant::now();
        let me = client.me().await.expect("refresh and me must both reach the fallback");
        let elapsed = started.elapsed();
        assert_eq!(me.user.id, "u1");
        assert!(
            elapsed * 2 < crate::tono::commands::RESTORE_TRANSACTION_TIMEOUT,
            "refresh + me spent {elapsed:?}; the second request waited on the dead pins again"
        );

        // The learned preference must not outlive a cancelled attempt: the restore deadline
        // dropping a request stuck on a resolver that became a blackhole leaves healthy pins
        // to answer the next request (the retry path reuses this transport).
        let flipped = TonoTransport {
            client: tokio::sync::RwLock::new(
                TonoTransport::pinned_builder().resolve_to_addrs(host, &live).build().unwrap(),
            ),
            resolved: TonoTransport::builder().resolve_to_addrs(host, &dead).build().unwrap(),
            alternate_port: std::sync::atomic::AtomicU16::new(0),
            prefer_resolved: std::sync::atomic::AtomicBool::new(true),
            answers: std::sync::atomic::AtomicU64::new(0),
            resolved_first: TonoTransport::pinned_builder().resolve_to_addrs(host, &dead).build().unwrap(),
            tunnel_port: std::sync::atomic::AtomicU16::new(0),
            relays: Vec::new(),
            preferred_relay: std::sync::atomic::AtomicUsize::new(0),
        };
        let get = || ApiRequest {
            method: HttpMethod::Get,
            url: format!("http://{host}:{port}/api/v1/me"),
            bearer: None,
            json_body: None,
            binary_body: None,
            headers: Vec::new(),
        };
        tokio::time::timeout(Duration::from_millis(500), flipped.send(get()))
            .await
            .expect_err("the preferred attempt is stuck on the blackholed resolver");
        let started = std::time::Instant::now();
        let response = flipped.send(get()).await.expect("the pins answer");
        assert_eq!(response.status, 200);
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "after a cancelled preferred attempt the next request waited {:?} before the pins",
            started.elapsed()
        );
    }

    /// A POST is not re-sent when the failure might already have delivered it.
    ///
    /// The fallback deliberately reuses `should_retry_transport` rather than a
    /// looser rule of its own. A response that never arrives is not proof the
    /// request did not: re-sending here would issue a second login code, or repeat
    /// a device deletion, on every stalled connection.
    #[tokio::test]
    async fn a_stalled_post_is_not_re_sent_to_the_second_client() {
        use std::sync::Arc;
        use std::sync::atomic::{AtomicUsize, Ordering};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let connections = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&connections);
        std::thread::spawn(move || {
            let mut held = Vec::new();
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                counter.fetch_add(1, Ordering::SeqCst);
                // Accepted and never answered: the connect succeeds, so the
                // failure is a read timeout rather than a connect timeout.
                held.push(stream);
            }
        });

        let live = vec![std::net::SocketAddr::from(([127, 0, 0, 1], port))];
        let transport =
            TonoTransport::with_clients("tono-stall.test", &live, &live).expect("transport");
        let error = transport
            .send(ApiRequest {
                method: HttpMethod::Post,
                url: format!("http://tono-stall.test:{port}/"),
                bearer: None,
                json_body: Some("{}".to_string()),
                binary_body: None,
                headers: Vec::new(),
            })
            .await
            .expect_err("a server that never answers must fail");
        let ApiError::Transport { kind, .. } = error else {
            panic!("expected a transport error");
        };
        assert_eq!(
            kind,
            TransportKind::Timeout,
            "a completed connect that never answers is the ambiguous case"
        );
        assert_eq!(
            connections.load(Ordering::SeqCst),
            1,
            "the POST was sent twice; a stalled request may already have been delivered"
        );
    }

    /// And when neither path works, the failure says so about both. "Pinned
    /// unreachable, system DNS fine" and "nothing reachable at all" need opposite
    /// responses, and a merged sentence cannot separate them.
    #[tokio::test]
    async fn a_total_failure_reports_both_paths() {
        if blackhole_is_intercepted() {
            eprintln!(
                "skipped: a tunnel is completing the blackhole connect, so both \
                 halves report a response timeout rather than a connect phase; \
                 run without a VPN, as CI does"
            );
            return;
        }
        let dead = vec![std::net::SocketAddr::from(([10, 255, 255, 1], 443))];
        let transport = TonoTransport::with_clients("tono-nowhere.test", &dead, &dead)
            .expect("transport");
        let error = transport
            .send(ApiRequest {
                method: HttpMethod::Get,
                url: "http://tono-nowhere.test/".to_string(),
                bearer: None,
                json_body: None,
                binary_body: None,
                headers: Vec::new(),
            })
            .await
            .expect_err("both paths are dead");
        let ApiError::Transport { message, .. } = error else {
            panic!("expected a transport error");
        };
        assert!(message.contains("pinned["), "{message}");
        assert!(message.contains("system-dns["), "{message}");
        // Not only that both were tried: each half must still say which phase
        // failed and why. Asserting the merge markers alone passed even when the
        // message fell back to reqwest's bare sentence.
        assert!(
            message.contains("connect:"),
            "the phase is missing from the reported message: {message}"
        );
    }

    #[test]
    fn http_method_mapping() {
        assert_eq!(method_of(HttpMethod::Get), reqwest::Method::GET);
        assert_eq!(method_of(HttpMethod::Post), reqwest::Method::POST);
        assert_eq!(method_of(HttpMethod::Delete), reqwest::Method::DELETE);
    }

    #[test]
    fn response_cap_is_two_mib() {
        assert_eq!(MAX_RESPONSE_BYTES, 2 * 1024 * 1024);
    }

    #[test]
    fn mainland_link_timeouts_are_30s_connect_45s_total() {
        assert_eq!(CONNECT_TIMEOUT, std::time::Duration::from_secs(30));
        assert_eq!(TOTAL_TIMEOUT, std::time::Duration::from_secs(45));
    }
    /// The port set the client walks must be the one the kill switch permits.
    ///
    /// A port the transport tries but rule C refuses is worse than not trying it: while the
    /// switch is armed the attempt is blocked by Tono's own firewall, and the user sees a
    /// failure that looks like the network. One constant, both sides — this asserts the
    /// transport reads it rather than keeping a copy.
    #[test]
    fn alternate_ports_come_from_the_shared_constant() {
        let ports = tono_service_protocol::CONTROL_PLANE_PORTS;
        assert_eq!(ports[0], 443, "443 stays the preferred path");
        assert!(ports.len() > 1, "there must be something to fall back to");
        assert!(
            ports.iter().skip(1).all(|port| *port != 443),
            "443 must appear once so the fallback never repeats the port that just failed"
        );
    }

    /// The delivery judgement the alternate-port walk has to make per attempt.
    ///
    /// The first version consulted `should_retry_transport` once, before the walk, and then
    /// looked only at `Ok` for each port. A `Tls` or `Timeout` failure on 2053 — both of which
    /// can mean the server already has the bytes — therefore moved on and sent the body to
    /// 2083. On the route this exists for that is a sign-in code submitted twice; on `DELETE`
    /// it is a device removed twice. This pins the predicate the walk now consults per attempt.
    #[test]
    fn only_provably_undelivered_failures_may_move_to_the_next_port() {
        for kind in [TransportKind::Dns, TransportKind::Connect] {
            assert!(
                should_retry_transport(HttpMethod::Post, kind),
                "{kind:?} proves the bytes never left, so the next port is safe"
            );
        }
        for kind in [TransportKind::Tls, TransportKind::Timeout, TransportKind::Other] {
            assert!(
                !should_retry_transport(HttpMethod::Post, kind),
                "{kind:?} may already have delivered the request; the walk must stop"
            );
            assert!(!should_retry_transport(HttpMethod::Delete, kind));
        }
        // A GET carries no side effect, so any transport failure may be retried.
        for kind in [
            TransportKind::Dns,
            TransportKind::Connect,
            TransportKind::Tls,
            TransportKind::Timeout,
            TransportKind::Other,
        ] {
            assert!(should_retry_transport(HttpMethod::Get, kind));
        }
    }

    #[test]
    fn with_port_rewrites_only_the_port() {
        let rewritten = TonoTransport::with_port(
            "https://api.example.com/api/v1/auth/email/verify",
            2053,
        )
        .expect("rewrite");
        assert_eq!(
            rewritten,
            "https://api.example.com:2053/api/v1/auth/email/verify",
            "host, scheme and path must survive so TLS still validates the same name"
        );
        assert!(TonoTransport::with_port("not a url", 2053).is_none());
    }

}
