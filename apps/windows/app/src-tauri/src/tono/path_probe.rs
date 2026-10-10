//! Backlog A4 (D14-A, decision 079): the pre-login network self-check.
//!
//! When the sign-in screen is next, every control-plane path `TonoTransport::send` walks is
//! probed in parallel: the pinned Cloudflare addresses, the system resolver, and the Tono relays
//! (decision 077). A probe is a TCP connection and a TLS handshake and nothing more. No HTTP
//! request is sent, so there is no cookie, token, device or installation id and no `X-Tono-*`
//! header. TLS carries `bootstrap::API_HOST` as SNI and the certificate is checked by the
//! platform verifier, the one reqwest uses for every API request; a certificate that is not
//! valid for the host fails the probe. Each path has `PROBE_BUDGET`, and the paths run at once.
//!
//! The first path in the transport's own order that completed a handshake is kept in
//! `PROBE_CACHE_FILE` for `PROBE_TTL` (one global record: there is no cheap network identity
//! here) and seeds the transport's existing preference (`prefer_resolved`, `preferred_relay`)
//! as if a request had just answered there; the next launch reads the record back. The walk
//! itself is unchanged: a preferred path that fails hands over to the usual order under the same
//! retry rule, so a request that may have been delivered is never sent again. The record names a
//! path, never an address, so it cannot send traffic anywhere the compiled paths do not go.
//! No WFP permit is added: while protection is armed, a path the filter blocks just fails here.

use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tono_logging::{Type, logging};

use crate::tono::{bootstrap, transport::TonoTransport};

/// One path's whole budget, TCP and TLS. Its addresses are tried at once.
pub(crate) const PROBE_BUDGET: Duration = Duration::from_secs(5);
/// A probe result older than this is ignored: the network that needed it has likely changed.
pub(crate) const PROBE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const PROBE_CACHE_FILE: &str = "control-plane-path.json";

/// The first path, in the transport's order, that completed a handshake.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProbedPath {
    Pinned,
    SystemDns,
    /// Index into `bootstrap::api_relays()`, the transport's relay order.
    Relay(usize),
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedProbe {
    path: String,
    #[serde(default)]
    relay: usize,
    at_ms: u64,
}

pub(crate) fn cache_file(dir: &Path) -> PathBuf {
    dir.join(PROBE_CACHE_FILE)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
}

/// The cached result, or `None` when it is missing, unreadable, dated in the future, or at least
/// `PROBE_TTL` old.
fn load(file: &Path, now_ms: u64) -> Option<ProbedPath> {
    let cached: CachedProbe = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
    let age = now_ms.checked_sub(cached.at_ms)?;
    if u128::from(age) >= PROBE_TTL.as_millis() {
        return None;
    }
    match cached.path.as_str() {
        "pinned" => Some(ProbedPath::Pinned),
        "system_dns" => Some(ProbedPath::SystemDns),
        "relay" => Some(ProbedPath::Relay(cached.relay)),
        _ => None,
    }
}

fn store(file: &Path, path: ProbedPath, at_ms: u64) -> std::io::Result<()> {
    let (name, relay) = match path {
        ProbedPath::Pinned => ("pinned", 0),
        ProbedPath::SystemDns => ("system_dns", 0),
        ProbedPath::Relay(index) => ("relay", index),
    };
    let body = serde_json::to_vec(&CachedProbe { path: name.to_owned(), relay, at_ms })?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let staging = file.with_extension("json.tmp");
    std::fs::write(&staging, body)?;
    std::fs::rename(&staging, file)
}

/// At launch: seed the transport from a cached result younger than `PROBE_TTL`, before any
/// request. Returns the path it put first.
pub(crate) fn adopt_cached(transport: &TonoTransport, dir: &Path) -> Option<ProbedPath> {
    adopt_cached_at(transport, &cache_file(dir), now_ms())
}

fn adopt_cached_at(transport: &TonoTransport, file: &Path, now_ms: u64) -> Option<ProbedPath> {
    let path = load(file, now_ms)?;
    transport
        .prefer_probed_path(path, transport.answers_seen())
        .then_some(path)
}

/// Probe every path, keep the result for `PROBE_TTL` and put that path first, unless a request
/// answered while the probe ran (an answer outranks a handshake). Nothing reached keeps the
/// previous record and preference. Bounded by `PROBE_BUDGET`; never awaited by the UI.
pub(crate) async fn run_before_sign_in(transport: &TonoTransport, dir: &Path) {
    let answers = transport.answers_seen();
    let started = std::time::Instant::now();
    let config = match tls_config() {
        Ok(config) => config,
        Err(error) => {
            logging!(warn, Type::Tono, "Tono: pre-login path probe not run: {error}");
            return;
        }
    };
    let pins: Vec<SocketAddr> = bootstrap::control_plane_http_pins()
        .into_iter()
        .map(|ip| SocketAddr::new(std::net::IpAddr::V4(ip), 443))
        .collect();
    let relays = bootstrap::api_relays();
    let (pinned, system_dns, relay) = tokio::join!(
        reaches_any(&config, &pins),
        system_resolver_reaches(&config),
        first_relay_reached(&config, &relays),
    );
    let verdict = if pinned {
        Some(ProbedPath::Pinned)
    } else if system_dns {
        Some(ProbedPath::SystemDns)
    } else {
        relay.map(ProbedPath::Relay)
    };
    logging!(
        info,
        Type::Tono,
        "Tono: pre-login path probe in {:?}: pinned={pinned} system_dns={system_dns} relay={relay:?}",
        started.elapsed()
    );
    let Some(path) = verdict else {
        return;
    };
    if let Err(error) = store(&cache_file(dir), path, now_ms()) {
        logging!(warn, Type::Tono, "Tono: pre-login path probe result not kept: {error}");
    }
    transport.prefer_probed_path(path, answers);
}

/// The platform verifier, as reqwest's own rustls stack uses, over the ring provider.
fn tls_config() -> Result<Arc<rustls::ClientConfig>, rustls::Error> {
    use rustls_platform_verifier::BuilderVerifierExt as _;

    let mut config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()?
    .with_platform_verifier()?
    .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(Arc::new(config))
}

/// TCP, then TLS for `bootstrap::API_HOST`, to `address`; closed without sending a byte of
/// application data.
async fn handshake(config: &Arc<rustls::ClientConfig>, address: SocketAddr) -> bool {
    let attempt = async {
        let name = rustls::pki_types::ServerName::try_from(bootstrap::API_HOST).ok()?;
        let tcp = tokio::net::TcpStream::connect(address).await.ok()?;
        tokio_rustls::TlsConnector::from(Arc::clone(config))
            .connect(name, tcp)
            .await
            .ok()
    };
    matches!(tokio::time::timeout(PROBE_BUDGET, attempt).await, Ok(Some(_)))
}

async fn reaches_any(config: &Arc<rustls::ClientConfig>, addresses: &[SocketAddr]) -> bool {
    futures::future::join_all(addresses.iter().map(|address| handshake(config, *address)))
        .await
        .into_iter()
        .any(|reached| reached)
}

/// Whatever the system resolver returns for the API host, as the `resolved` client sees it.
async fn system_resolver_reaches(config: &Arc<rustls::ClientConfig>) -> bool {
    let attempt = async {
        let Ok(addresses) = tokio::net::lookup_host((bootstrap::API_HOST, 443)).await else {
            return false;
        };
        let addresses: Vec<SocketAddr> = addresses.collect();
        reaches_any(config, &addresses).await
    };
    tokio::time::timeout(PROBE_BUDGET, attempt)
        .await
        .unwrap_or(false)
}

/// The first relay, in the compiled order, that completed a handshake.
async fn first_relay_reached(
    config: &Arc<rustls::ClientConfig>,
    relays: &[SocketAddr],
) -> Option<usize> {
    futures::future::join_all(relays.iter().map(|relay| handshake(config, *relay)))
        .await
        .into_iter()
        .position(|reached| reached)
}

#[cfg(test)]
mod tests {
    use super::{PROBE_TTL, ProbedPath, adopt_cached_at, cache_file, now_ms, store};
    use crate::tono::transport::TonoTransport;
    use tono_core::auth::{ApiRequest, HttpMethod, HttpTransport as _};

    /// A local HTTP server that answers every request with `body`.
    fn serve(body: &'static str) -> std::net::SocketAddr {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("addr");
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
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.flush();
                let _ = stream.shutdown(std::net::Shutdown::Write);
            }
        });
        address
    }

    /// Backlog A4: a cached probe result "relay works, direct dead" sends the first sign-in to
    /// the relay, ahead of the pins that lead the usual walk; a result more than a day old is
    /// ignored and the pins go first again.
    #[tokio::test]
    async fn a_cached_relay_probe_sends_the_first_sign_in_to_the_relay_until_it_is_a_day_old() {
        // Both direct paths and the relay answer, each with its own name, so the body says which
        // path carried the first attempt. The URL has no port: each path's socket supplies it.
        let direct = [serve("direct")];
        let relay = [serve("relay")];
        let dir = std::env::temp_dir().join(format!("tono-path-probe-{}-{}", std::process::id(), now_ms()));
        let file = cache_file(&dir);
        let request = ApiRequest {
            method: HttpMethod::Post,
            url: "http://tono-probe.test/api/v1/auth/email/start".to_owned(),
            bearer: None,
            json_body: Some("{}".to_owned()),
            binary_body: None,
            headers: Vec::new(),
        };
        let now = now_ms();

        store(&file, ProbedPath::Relay(0), now - 60_000).expect("store a fresh probe result");
        let transport = TonoTransport::with_clients_and_relays("tono-probe.test", &direct, &direct, &relay)
            .expect("transport");
        assert_eq!(adopt_cached_at(&transport, &file, now), Some(ProbedPath::Relay(0)));
        let first = transport.send(request.clone()).await.expect("first sign-in");
        assert_eq!(first.body, b"relay", "the first sign-in goes to the relay the probe reached");

        let day_old = now - u64::try_from(PROBE_TTL.as_millis()).expect("ttl") - 60_000;
        store(&file, ProbedPath::Relay(0), day_old).expect("store a day-old probe result");
        let transport = TonoTransport::with_clients_and_relays("tono-probe.test", &direct, &direct, &relay)
            .expect("transport");
        assert_eq!(adopt_cached_at(&transport, &file, now), None, "a day-old result is ignored");
        let first = transport.send(request).await.expect("first sign-in");
        assert_eq!(first.body, b"direct", "without a fresh probe result the usual order runs");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
