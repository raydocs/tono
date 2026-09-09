//! Fake-IP, post-lock, and TUN/data-plane proofs used by the connect stage sequence.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tono_core::EXIT_GROUP_NAME;
use tono_logging::{Type, logging};
use tono_service_protocol::{KillSwitchStatus, KillSwitchStatusMode};

use crate::core::service;
use crate::tono::state::TonoState;
use super::controller::{controller_client, controller_url};
use super::failure::{
    NODE_OR_CORE_UNREACHABLE_PREFIX, TUN_DATA_PLANE_BROKEN_PREFIX, TUN_INGRESS_BROKEN_PREFIX,
};

/// §6.8 exit probe target.
pub(super) const EXIT_PROBE_URL: &str = "https://www.gstatic.com/generate_204";

/// §6.8: the probe also proves fake-ip DNS via this lookup.
pub(super) const FAKE_IP_LOOKUP_HOST: &str = "www.gstatic.com";

/// §6.7 DNS verification retry count.
pub(super) const VERIFY_ATTEMPTS: u32 = 3;

pub(super) const VERIFY_RETRY_INTERVAL: Duration = Duration::from_millis(500);

/// C2 — §6.8 exit-probe budgets. `unified-delay` is on, so `/delay` reports the
/// second sample (warm RTT) and is UI/advisory only. Completing both samples on a
/// distant Reality exit is typically 1.5–3.5 s; 8 s still covers it.
pub(super) const EXIT_PROBE_CORE_TIMEOUT_MS: u64 = 8_000;

/// The HTTP client must always outlast the core budget by a real margin, so the *core* decides
/// the verdict of an exit probe. 3 s over the core budget covers the loopback round trip, the
/// core's scheduling, and the JSON reply.
pub(super) const EXIT_PROBE_CLIENT_TIMEOUT: Duration = Duration::from_secs(11);

/// The controller delay request is advisory during Connect. Its reqwest timeout plus the
/// integration profile's maximum synthetic delay bounds the single attempt; retrying a doubled
/// `unified-delay` request made a harmless 504 consume 38 seconds before the authoritative real
/// App data-plane check was even allowed to run.
#[cfg(test)]
pub(super) const EXIT_PROBE_ADVISORY_BUDGET: Duration = Duration::from_secs(16);

/// One attempt through the Windows DNS Client. The Windows path uses cancellable `DnsQueryEx`,
/// so a slow adapter transition can consume this budget without leaving stale `getaddrinfo`
/// workers behind; all bounded attempts remain available on high-latency machines.
pub(super) const FAKE_IP_LOOKUP_TIMEOUT: Duration = Duration::from_secs(5);

/// §6.9 must prove traffic from the App itself, not merely ask Mihomo whether Mihomo can reach
/// the Internet. The client is fresh, ignores all explicit proxy settings, resolves through the
/// protected system DNS, and therefore has only one permitted path while WFP is locked: WinTUN.
// A 4 s connect ceiling passed the local 1 s synthetic-latency profile but failed on real
// mainland-to-US paths: that profile delays *before* the request and therefore does not consume
// reqwest's DNS + proxy handshake + TLS connect budget. The Buffalo reports show the independent
// controller request completing in 2.5 s while every real App request exhausts exactly this 4 s
// connect ceiling. Twelve seconds covers several cross-border handshakes without weakening the
// verdict; the whole request remains absolutely bounded and still has to return the exact TLS
// origin status.
pub(super) const TUN_DATA_PLANE_CONNECT_TIMEOUT: Duration = Duration::from_secs(12);

pub(super) const TUN_DATA_PLANE_TIMEOUT: Duration = Duration::from_secs(18);

/// Happy-eyeballs spacing between the three TLS origins. Starting them in the
/// same millisecond on a cold Reality path made the first verification round
/// lose to self-congestion even when the node was healthy.
pub(super) const TUN_PROBE_STAGGER: Duration = Duration::from_millis(100);

/// A single public origin is not a data plane. The controller probe and 0.0.7's App probe both
/// targeted Google, so one node-to-Google failure made two nominally independent checks fail
/// together on a mainland tester. Race independent TLS origins and accept the first exact,
/// authenticated response. Because WFP is already verified Locked, any such fresh App flow can
/// only leave through WinTUN; an ordinary physical-interface fallback remains impossible.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct TunDataPlaneProbe {
    pub(super) label: &'static str,
    pub(super) url: &'static str,
    pub(super) expected_status: u16,
}

pub(super) const TUN_DATA_PLANE_PROBES: [TunDataPlaneProbe; 3] = [
    TunDataPlaneProbe {
        label: "Google",
        url: EXIT_PROBE_URL,
        expected_status: 204,
    },
    TunDataPlaneProbe {
        label: "Cloudflare",
        url: "https://cp.cloudflare.com/generate_204",
        expected_status: 204,
    },
    TunDataPlaneProbe {
        label: "Apple",
        url: "https://www.apple.com/library/test/success.html",
        expected_status: 200,
    },
];

/// V1/H1 — §6.9 kill-switch verification retries. `KillSwitchStatus.live` on Windows is not a
/// live query: it is a ~1.5 s-decaying cache refreshed by a 1 s loop, so one slow-but-successful
/// verify reads `live: false` and fails a healthy tunnel. Every other stage retries (`lock` 50×,
/// `verify_fake_ip` 3×, `wait_controller` 64×); the only stage reading a
/// time-decayed field retried zero times. The window deliberately spans more than one full
/// refresh period, so the verdict is never decided by a single sample of a decaying value.
pub(super) const VERIFY_LOCK_ATTEMPTS: u32 = 4;

pub(super) const VERIFY_LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(700);

#[derive(Debug, PartialEq, Eq)]
pub(super) enum PostLockVerification<T> {
    Verified {
        status: T,
        controller_warning: Option<String>,
    },
    Unverified {
        code: tono_core::ProtectedFailureCode,
        error: String,
    },
}

pub(super) fn classify_post_lock_verification<T>(
    controller_probe: Result<(), String>,
    data_plane: Result<T, String>,
) -> PostLockVerification<T> {
    match tono_core::classify_post_lock(controller_probe, data_plane) {
        tono_core::PostLockDecision::Connected {
            status,
            controller_advisory,
        } => PostLockVerification::Verified {
            status,
            controller_warning: controller_advisory,
        },
        tono_core::PostLockDecision::ConnectedUnverified { code, error } => {
            PostLockVerification::Unverified { code, error }
        }
    }
}

pub(super) fn classify_exhausted_data_plane(
    controller_probe: Result<(), String>,
    data_plane: String,
    proxy_cross_check: Result<(), String>,
) -> String {
    let (code, _) = tono_core::classify_exhausted_data_plane(
        controller_probe.clone(),
        data_plane.clone(),
        proxy_cross_check.clone(),
        false,
    );
    let body = match (controller_probe, proxy_cross_check) {
        (Ok(()), Ok(())) => format!(
            "{TUN_DATA_PLANE_BROKEN_PREFIX}: selected node and Mihomo proxy egress passed, but the Windows TUN data plane failed: {data_plane}"
        ),
        (Err(controller), Ok(())) => format!(
            "{TUN_DATA_PLANE_BROKEN_PREFIX}: loopback proxy egress passed despite controller warning ({controller}), but the Windows TUN data plane failed: {data_plane}"
        ),
        (Ok(()), Err(proxy)) => format!(
            "{TUN_INGRESS_BROKEN_PREFIX}: controller node egress passed, but both App ingress paths failed; TUN: {data_plane}; loopback proxy: {proxy}"
        ),
        (Err(controller), Err(proxy)) => format!(
            "{NODE_OR_CORE_UNREACHABLE_PREFIX}: controller, Windows TUN, and loopback proxy checks all failed; controller: {controller}; TUN: {data_plane}; loopback proxy: {proxy}"
        ),
    };
    format!("{body} [{}]", code.as_str())
}

/// fake-ip range check (§5: 198.18.0.0/16).
pub fn is_fake_ip(addr: IpAddr) -> bool {
    match addr {
        IpAddr::V4(v4) => v4.octets()[0] == 198 && v4.octets()[1] == 18,
        IpAddr::V6(_) => false,
    }
}

/// §6.7: an ordinary system lookup must return a fake-ip address. On Windows, use the DNS Client
/// API directly with cache bypass and true cancellation; this keeps all three propagation retries
/// useful instead of accumulating uncancellable `getaddrinfo` work.
pub(super) async fn verify_fake_ip() -> Result<(), String> {
    let mut last = String::from("no answer");
    for attempt in 0..VERIFY_ATTEMPTS {
        let lookup_timeout = fake_ip_attempt_timeout(attempt);
        #[cfg(windows)]
        let lookup = crate::tono::windows_dns::query_a(FAKE_IP_LOOKUP_HOST, lookup_timeout)
            .await
            .map(|addrs| addrs.into_iter().map(IpAddr::V4).collect::<Vec<_>>());
        #[cfg(not(windows))]
        let lookup = tokio::time::timeout(
            lookup_timeout,
            tokio::net::lookup_host((FAKE_IP_LOOKUP_HOST, 443)),
        )
        .await
        .map_err(|_| format!("system DNS lookup exceeded {lookup_timeout:?}"))
        .and_then(|result| {
            result
                .map(|addrs| addrs.map(|addr| addr.ip()).collect::<Vec<_>>())
                .map_err(|e| e.to_string())
        });

        match lookup {
            Ok(addrs) => {
                if addrs.iter().copied().any(is_fake_ip) {
                    return Ok(());
                }
                last = format!("no fake-ip in {addrs:?}");
            }
            Err(err) => last = err,
        }
        if attempt + 1 < VERIFY_ATTEMPTS {
            tokio::time::sleep(VERIFY_RETRY_INTERVAL).await;
        }
    }
    Err(fake_ip_verification_error(&last))
}

pub(super) fn fake_ip_verification_error(last: &str) -> String {
    if last.contains("no fake-ip in") {
        format!(
            "fake-ip verification failed: {last}. Windows Encrypted DNS (DNS over HTTPS) may still be overriding 127.0.0.1. Turn Encrypted DNS off in Settings → Network & internet → Ethernet/Wi-Fi → DNS, then reconnect."
        )
    } else {
        format!("fake-ip verification failed: {last}")
    }
}

pub(super) fn connect_failure_is_dead_exit(error: &str) -> bool {
    error.contains(NODE_OR_CORE_UNREACHABLE_PREFIX)
        || error.contains(tono_core::ProtectedFailureCode::CoreExitUnreachable.as_str())
}

pub(super) fn fake_ip_attempt_timeout(attempt: u32) -> Duration {
    if attempt == 0 {
        Duration::from_secs(2)
    } else {
        FAKE_IP_LOOKUP_TIMEOUT
    }
}

/// One exit probe: `GET /proxies/Tono-Exit/delay` against the generate_204 target with an
/// [`EXIT_PROBE_CORE_TIMEOUT_MS`] core-side budget; a positive delay proves egress. The client
/// budget ([`EXIT_PROBE_CLIENT_TIMEOUT`]) is strictly larger, so the verdict — including a
/// mihomo-reported failure — always comes from the core (C2).
///
/// Mihomo `unified-delay` already discards the cold handshake inside this one
/// call. A second `/delay` here would add another cross-border round to connect
/// without changing the number the UI shows. Japan→gstatic through Reality
/// commonly lands 400–900ms; that is not a dead node.
pub(super) async fn probe_exit_once(secret: &str, controller_port: u16) -> Result<u64, String> {
    let client = controller_client(EXIT_PROBE_CLIENT_TIMEOUT)?;
    let mut url = reqwest::Url::parse(&controller_url(
        controller_port,
        &format!("/proxies/{EXIT_GROUP_NAME}/delay"),
    ))
    .map_err(|err| err.to_string())?;
    url.query_pairs_mut()
        .append_pair("url", EXIT_PROBE_URL)
        .append_pair("timeout", &EXIT_PROBE_CORE_TIMEOUT_MS.to_string());

    crate::tono::integration_profile::delay_remote_operation().await;
    match client.get(url).bearer_auth(secret).send().await {
        Ok(response) if response.status().is_success() => match response.json::<serde_json::Value>().await {
            Ok(value) => {
                let delay = value.get("delay").and_then(serde_json::Value::as_u64).unwrap_or(0);
                if delay > 0 {
                    Ok(delay)
                } else {
                    Err("exit delay was 0".to_string())
                }
            }
            Err(err) => Err(err.to_string()),
        },
        Ok(response) => Err(format!("delay probe answered {}", response.status())),
        Err(err) => Err(err.to_string()),
    }
}

/// Run one real, bounded egress measurement for the currently connected server. The authenticated
/// in-memory controller endpoint is never exposed to the WebView; only the measured milliseconds
/// cross the Tauri command boundary.
pub async fn test_current_server(state: &Arc<TonoState>, app: &AppHandle) -> Result<u64, String> {
    let (secret, controller_port) = {
        let inner = state.lock().await;
        if !inner.fsm.status().is_connected {
            return Err("connect before testing the current server".to_string());
        }
        inner
            .controller_secret
            .clone()
            .zip(inner.controller_port)
            .ok_or_else(|| "connected controller endpoint is unavailable".to_string())?
    };
    let delay = probe_exit_once(&secret, controller_port)
        .await
        .map_err(|error| format!("current server test failed: {error}"))?;
    {
        let mut inner = state.lock().await;
        inner.record_exit_delay(delay);
        crate::tono::commands::emit_status(app, &crate::tono::commands::status_of(&inner));
    }
    Ok(delay)
}

/// V1/H1 — the retry window `verify_locked` spends before it calls a tunnel unverified. Must
/// exceed the Service-side liveness cache TTL, or the verdict is one sample of a decaying value.
pub fn verify_lock_retry_window() -> Duration {
    VERIFY_LOCK_RETRY_INTERVAL * (VERIFY_LOCK_ATTEMPTS.saturating_sub(1))
}

/// §6.9: the kill switch must be wanted, verified live, and fully locked.
///
/// V1/H1: bounded retry, never a single shot. `live` is not a live query on Windows — it is a
/// ~1.5 s-decaying cache refreshed by a 1 s loop — so a slow-but-successful verify reads
/// `live: false`. Retrying only re-*reads*: nothing but a `wanted && live && Locked` answer
/// passes, so the fail-closed verdict is unchanged, it is merely no longer decided by one sample.
pub(super) async fn verify_locked() -> Result<KillSwitchStatus, String> {
    let mut last = String::from("no answer");
    for attempt in 0..VERIFY_LOCK_ATTEMPTS {
        match service::tono_kill_switch_status().await {
            Ok(status) => {
                if status.wanted && status.live && status.mode == KillSwitchStatusMode::Locked {
                    return Ok(status);
                }
                last = format!(
                    "kill switch not locked (wanted={}, live={}, mode={:?})",
                    status.wanted, status.live, status.mode
                );
            }
            Err(err) => last = err.to_string(),
        }
        if attempt + 1 < VERIFY_LOCK_ATTEMPTS {
            tokio::time::sleep(VERIFY_LOCK_RETRY_INTERVAL).await;
        }
    }
    Err(format!(
        "{last} (after {VERIFY_LOCK_ATTEMPTS} samples over {:?})",
        verify_lock_retry_window()
    ))
}

async fn run_tun_race() -> Result<(), Vec<crate::tono::protected_probe::ProbeOriginResult>> {
    crate::tono::integration_profile::delay_remote_operation().await;
    crate::tono::protected_probe::verify_protected_origins(
        TUN_DATA_PLANE_CONNECT_TIMEOUT,
        TUN_DATA_PLANE_TIMEOUT,
        TUN_PROBE_STAGGER,
    )
    .await
    .map(|_| ())
}

pub(super) async fn verify_tun_data_plane() -> Result<(), String> {
    run_tun_race()
        .await
        .map_err(|failures| crate::tono::protected_probe::format_failures(&failures))
}

pub(super) const NODE_TCP_PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// TCP connect to the selected node's port. The returned token never includes
/// the address — ConnectFail/diagnostics must show ASN/class, not IP.
/// After WFP lock, the App's direct TCP to the node is often just dropped
/// (`tcp`). That is not a GFW/node verdict. Only RST/timeout (or a measured
/// RTT) belong on the TUN failure string.
pub(super) fn admit_tcp_probe_note(tcp: Result<u64, &'static str>) -> Option<String> {
    match tcp {
        Ok(delay_ms) => Some(format!("tcp :443 {delay_ms}ms")),
        Err(token @ "RST") | Err(token @ "i/o timeout") => Some(format!("tcp :443 {token}")),
        Err(_) => None,
    }
}

pub(super) fn classify_tcp_connect_error(error: &str) -> &'static str {
    let detail = error.to_ascii_lowercase();
    if detail.contains("reset")
        || detail.contains("rst")
        || detail.contains("forcibly closed")
        || detail.contains("refused")
    {
        "RST"
    } else if detail.contains("timed out") || detail.contains("timeout") {
        "i/o timeout"
    } else {
        "tcp"
    }
}

pub(super) async fn probe_node_tcp(addr: SocketAddr) -> Result<u64, &'static str> {
    let started = Instant::now();
    match tokio::time::timeout(NODE_TCP_PROBE_TIMEOUT, tokio::net::TcpStream::connect(addr)).await {
        Ok(Ok(stream)) => {
            drop(stream);
            Ok(started.elapsed().as_millis().max(1) as u64)
        }
        Ok(Err(error)) => Err(classify_tcp_connect_error(&error.to_string())),
        Err(_) => Err("i/o timeout"),
    }
}

pub(super) fn tun_probe_stagger(index: usize) -> Duration {
    TUN_PROBE_STAGGER * (index as u32)
}

pub(super) fn format_tun_probe_failures(failures: &[String]) -> String {
    format!(
        "all {} independent real TUN data-plane probes failed: {}",
        TUN_DATA_PLANE_PROBES.len(),
        failures.join(" | ")
    )
}

#[cfg(test)]
mod tests {
    use super::{admit_tcp_probe_note, classify_tcp_connect_error};

    #[test]
    fn locked_path_generic_tcp_is_not_a_node_death() {
        assert_eq!(admit_tcp_probe_note(Ok(42)), Some("tcp :443 42ms".into()));
        assert_eq!(
            admit_tcp_probe_note(Err("RST")),
            Some("tcp :443 RST".into())
        );
        assert_eq!(
            admit_tcp_probe_note(Err("i/o timeout")),
            Some("tcp :443 i/o timeout".into())
        );
        assert_eq!(
            admit_tcp_probe_note(Err("tcp")),
            None,
            "WFP-denied direct dial after lock must not look like a dead node"
        );
    }

    #[test]
    fn tcp_connect_errors_are_rst_or_timeout_without_an_address() {
        assert_eq!(
            classify_tcp_connect_error("connection reset by peer 203.0.113.9:443"),
            "RST"
        );
        assert_eq!(classify_tcp_connect_error("timed out"), "i/o timeout");
        let token = classify_tcp_connect_error("connection reset by peer 203.0.113.9:443");
        assert!(!token.contains("203.0.113"));
        assert!(!token.contains(':'));
    }
}
