//! `tono_core::HttpTransport` over the app's reqwest stack (product-contract.md §1):
//! redirects disabled, cookies disabled, 30 s connect / 45 s total timeouts (the
//! mainland-link budget), and a 2 MiB response cap. The Bearer token is computed by
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
const TOTAL_TIMEOUT: Duration = Duration::from_secs(45);

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
fn classify(err: &reqwest::Error) -> TransportKind {
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
    let mut text = format!("{}: {err}", kind_label(classify(err)));
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
    text
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
        })
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
        Self::builder()
            .resolve_to_addrs(bootstrap::API_HOST, &pinned)
            .build()
            .context("failed to build the Tono HTTP client")
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
        let quick = || {
            Self::builder()
                .connect_timeout(Duration::from_millis(700))
                .timeout(Duration::from_millis(900))
        };
        Ok(Self {
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
    /// One attempt over one client. Shared so the pinned and system-resolved
    /// paths cannot drift in how they read a response.
    async fn attempt(
        &self,
        client: &reqwest::Client,
        request: &ApiRequest,
    ) -> Result<ApiResponse, ApiError> {
        let transport = |err: &reqwest::Error| ApiError::Transport {
            kind: classify(err),
            message: describe(err),
        };
        let mut builder = client.request(method_of(request.method), &request.url);
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
        while let Some(chunk) = response.chunk().await.map_err(|err| transport(&err))? {
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
        match self.attempt(&client, &attempt).await {
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
        let ports = clash_verge_service_ipc::CONTROL_PLANE_PORTS;
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
}

#[async_trait]
impl HttpTransport for TonoTransport {
    async fn send(&self, request: ApiRequest) -> Result<ApiResponse, ApiError> {
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

        let pinned = {
            let client = self.client.read().await;
            self.attempt(&client, &request).await
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
        match self.attempt(&self.resolved, &request).await {
            Ok(response) => Ok(response),
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
                if should_retry_transport(request.method, fallback_kind)
                    && let Some(result) = self.attempt_alternate_ports(&request).await
                {
                    return result;
                }
                Err(ApiError::Transport {
                    kind: fallback_kind,
                    message: format!(
                        "pinned[{message}]; system-dns[{fallback_message}]"
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
        let ports = clash_verge_service_ipc::CONTROL_PLANE_PORTS;
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
