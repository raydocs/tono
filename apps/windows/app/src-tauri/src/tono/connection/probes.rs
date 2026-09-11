//! System fake-ip admission and explicit/advisory diagnostics. Third-party HTTPS is not a gate.

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

/// Only a name for the protected system DNS lookup: expect a synthetic address, not a Google
/// response. No Google TLS/HTTP request or remote reachability result participates in admission.
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
    fake_ip_sequence(|attempt| query_fake_ip_once(attempt, false), || async { Ok(()) })
        .await
        .map_err(|error| match error {
            super::failure::StageFailure::Error(message)
            | super::failure::StageFailure::TimedOut(message) => message,
            super::failure::StageFailure::Stale => "DNS verification superseded".to_owned(),
        })
}

struct FakeIpFailure {
    detail: String,
    may_reapply_dns: bool,
}

/// Preserve the original three query attempts and per-query budgets. Admission may insert ONE
/// native DNS refresh between them; monitoring uses a no-op and retains its existing behavior.
/// Unknown errors, access/auth failures and unsettled native cancellation never authorize repair.
pub(super) async fn verify_fake_ip_with_repair<F, Fut>(
    repair: F,
) -> Result<(), super::failure::StageFailure>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<(), super::failure::StageFailure>>,
{
    fake_ip_sequence(|attempt| query_fake_ip_once(attempt, true), repair).await
}

async fn fake_ip_sequence<Q, Query, F, Repair>(
    mut query: Q,
    mut repair: F,
) -> Result<(), super::failure::StageFailure>
where
    Q: FnMut(u32) -> Query,
    Query: std::future::Future<Output = Result<(), FakeIpFailure>>,
    F: FnMut() -> Repair,
    Repair: std::future::Future<Output = Result<(), super::failure::StageFailure>>,
{
    let mut last = String::from("no answer");
    let mut repaired = false;
    for attempt in 0..VERIFY_ATTEMPTS {
        let failure = match query(attempt).await {
            Ok(()) => return Ok(()),
            Err(failure) => failure,
        };
        last = failure.detail;
        if attempt + 1 < VERIFY_ATTEMPTS {
            if failure.may_reapply_dns && !repaired {
                repaired = true;
                repair().await?;
            }
            tokio::time::sleep(VERIFY_RETRY_INTERVAL).await;
        }
    }
    Err(super::failure::StageFailure::error(
        fake_ip_verification_error(&last),
    ))
}

async fn query_fake_ip_once(attempt: u32, admission: bool) -> Result<(), FakeIpFailure> {
    let lookup_timeout = fake_ip_attempt_timeout(attempt);
    #[cfg(windows)]
    let lookup = if admission && attempt == 0 {
        crate::tono::windows_dns::query_fake_a_fresh(FAKE_IP_LOOKUP_HOST, lookup_timeout).await
    } else {
        crate::tono::windows_dns::query_a(FAKE_IP_LOOKUP_HOST, lookup_timeout).await
    }
        .map(|addrs| addrs.into_iter().map(IpAddr::V4).collect::<Vec<_>>());
    #[cfg(not(windows))]
    let _ = admission;
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
            .map_err(|error| error.to_string())
    });
    match lookup {
        Ok(addrs) if !addrs.is_empty() && addrs.iter().copied().all(is_fake_ip) => Ok(()),
        Ok(addrs) => Err(FakeIpFailure {
            detail: format!("no fake-ip in {addrs:?}"),
            may_reapply_dns: true,
        }),
        Err(detail) => Err(FakeIpFailure {
            may_reapply_dns: settled_dns_propagation_error(&detail),
            detail,
        }),
    }
}

fn settled_dns_propagation_error(detail: &str) -> bool {
    // Only strings produced by our DNS wrapper, not a broad contains("timeout") classifier.
    (detail.starts_with("Windows system DNS A query exceeded ")
        && !detail.contains("cancellation did not settle"))
        || detail == "Windows system DNS A query returned no A records"
        || detail.starts_with("system DNS lookup exceeded ")
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

/// Legacy read-only status sampler, NOT used by admission/recovery. It reads
/// the watchdog's bounded observation cache; it cannot issue a fresh proof.
/// Admission now uses the session-bound Service verify-and-commit reply.
pub(super) async fn verify_locked() -> Result<KillSwitchStatus, String> {
    let mut last = String::from("no answer");
    for attempt in 0..VERIFY_LOCK_ATTEMPTS {
        match service::tono_kill_switch_status().await {
            Ok(status) => {
                if status.wanted
                    && status.live
                    && status.mode == KillSwitchStatusMode::Locked
                    && status.tunnel_permit_rendered
                {
                    return Ok(status);
                }
                last = format!(
                    "kill switch not locked (wanted={}, live={}, mode={:?}, tunnel_permit_rendered={})",
                    status.wanted, status.live, status.mode, status.tunnel_permit_rendered
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

/// Capture identity BEFORE fake-ip, not a claim that cached WFP status is admission
/// proof. Final Service commit rechecks this identity and the actual kernel set.
pub(super) fn capture_admission_core(snapshot: &tono_service_protocol::ServiceStatusSnapshot,
    session: &tono_service_protocol::OwnerSessionProof) -> Result<tono_service_protocol::ProtectionCommitRequest, String> {
    if !snapshot.is_active || snapshot.active_generation != Some(session.generation)
        || snapshot.service_state != tono_service_protocol::ServiceLifecycleState::Running
        || !snapshot.desired_core_should_be_running || snapshot.desired_state_unknown {
        return Err("Service/Core ownership is not settled before fake-ip".into());
    }
    Ok(tono_service_protocol::ProtectionCommitRequest {
        core_pid: snapshot.core_pid.filter(|pid| *pid != 0).ok_or("Core missing before fake-ip")?,
        core_generation: snapshot.core_generation,
    })
}

#[cfg(test)]
mod admission_dns_tests {
    use super::super::failure::StageFailure;
    use super::*;
    use std::cell::Cell;

    #[tokio::test(start_paused = true)]
    async fn propagation_repair_uses_remaining_attempts_and_happens_once() {
        let queries = Cell::new(0);
        let repairs = Cell::new(0);
        fake_ip_sequence(
            |_| {
                let attempt = queries.get();
                queries.set(attempt + 1);
                async move {
                    if attempt == 2 {
                        Ok(())
                    } else {
                        Err(FakeIpFailure {
                            detail: "not propagated".into(),
                            may_reapply_dns: true,
                        })
                    }
                }
            },
            || {
                repairs.set(repairs.get() + 1);
                async { Ok(()) }
            },
        )
        .await
        .unwrap();
        assert_eq!(queries.get(), VERIFY_ATTEMPTS);
        assert_eq!(repairs.get(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn healthy_first_answer_does_no_repair_and_failed_proof_never_succeeds() {
        let repairs = Cell::new(0);
        fake_ip_sequence(
            |_| async { Ok(()) },
            || {
                repairs.set(1);
                async { Ok(()) }
            },
        )
        .await
        .unwrap();
        assert_eq!(repairs.get(), 0);
        let queries = Cell::new(0);
        let result = fake_ip_sequence(
            |_| {
                queries.set(queries.get() + 1);
                async {
                    Err(FakeIpFailure {
                        detail: "no fake-ip".into(),
                        may_reapply_dns: true,
                    })
                }
            },
            || {
                repairs.set(repairs.get() + 1);
                async { Ok(()) }
            },
        )
        .await;
        assert!(matches!(result, Err(StageFailure::Error(_))));
        assert_eq!(queries.get(), VERIFY_ATTEMPTS);
        assert_eq!(repairs.get(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn stale_repair_stops_before_another_dns_query() {
        let queries = Cell::new(0);
        let result = fake_ip_sequence(
            |_| {
                queries.set(queries.get() + 1);
                async {
                    Err(FakeIpFailure {
                        detail: "not propagated".into(),
                        may_reapply_dns: true,
                    })
                }
            },
            || async { Err(StageFailure::Stale) },
        )
        .await;
        assert!(matches!(result, Err(StageFailure::Stale)));
        assert_eq!(queries.get(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn repair_shares_cancellation_and_the_attempts_original_deadline() {
        use super::super::transaction::{CONNECT_TRANSACTION_TIMEOUT, ConnectTransaction};
        use tokio_util::sync::CancellationToken;
        for cancel in [false, true] {
            let cancellation = CancellationToken::new();
            let transaction = ConnectTransaction::new(cancellation.clone());
            tokio::time::advance(CONNECT_TRANSACTION_TIMEOUT - Duration::from_secs(1)).await;
            let started = tokio::time::Instant::now();
            let queries = Cell::new(0);
            let result = transaction
                .wait(
                    "system fake-ip",
                    fake_ip_sequence(
                        |_| {
                            queries.set(queries.get() + 1);
                            async {
                                Err(FakeIpFailure {
                                    detail: "not propagated".into(),
                                    may_reapply_dns: true,
                                })
                            }
                        },
                        || {
                            if cancel {
                                cancellation.cancel();
                            }
                            std::future::pending::<Result<(), StageFailure>>()
                        },
                    ),
                )
                .await;
            assert_eq!(queries.get(), 1);
            if cancel {
                assert!(matches!(result, Err(StageFailure::Stale)));
                assert_eq!(started.elapsed(), Duration::ZERO);
            } else {
                assert!(matches!(result, Err(StageFailure::TimedOut(_))));
                assert_eq!(started.elapsed(), Duration::from_secs(1));
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn unknown_query_errors_keep_original_retries_without_an_optional_mutation() {
        let queries = Cell::new(0);
        let repairs = Cell::new(0);
        let result = fake_ip_sequence(
            |_| {
                queries.set(queries.get() + 1);
                async {
                    Err(FakeIpFailure {
                        detail: "access denied".into(),
                        may_reapply_dns: false,
                    })
                }
            },
            || {
                repairs.set(repairs.get() + 1);
                async { Ok(()) }
            },
        )
        .await;
        assert!(matches!(result, Err(StageFailure::Error(_))));
        assert_eq!(queries.get(), VERIFY_ATTEMPTS);
        assert_eq!(repairs.get(), 0);
    }

    #[test]
    fn arbitrary_transport_errors_and_unsettled_native_work_do_not_authorize_refresh() {
        assert!(settled_dns_propagation_error(
            "Windows system DNS A query exceeded 2s"
        ));
        assert!(settled_dns_propagation_error(
            "Windows system DNS A query returned no A records"
        ));
        for error in [
            "access denied",
            "owner mismatch",
            "RPC timeout",
            "authentication timeout",
            "Windows system DNS A query failed with status 5: Access denied",
            "Windows system DNS A query exceeded 2s and cancellation did not settle",
        ] {
            assert!(!settled_dns_propagation_error(error), "{error}");
        }
    }
}
