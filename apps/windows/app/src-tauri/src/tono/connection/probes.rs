//! Fake-IP, post-lock, and TUN/data-plane proofs used by the connect stage sequence.

use std::error::Error as _;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

use futures::{StreamExt as _, stream::FuturesUnordered};
use tauri::AppHandle;
use tono_core::EXIT_GROUP_NAME;
use tono_core::connection::ConnectStage;
use tono_logging::{Type, logging};
use tono_service_protocol::{KillSwitchStatus, KillSwitchStatusMode};

use crate::core::service;
use crate::tono::local_evidence::ProbeRecorder;
use crate::tono::{audit::{self, AuditEvent}, state::TonoState};
use super::controller::{
    CONTROLLER_HTTP_TIMEOUT, CONTROLLER_READY_TIMEOUT, VERSION_POLL_ATTEMPTS, VERSION_POLL_FAST_ATTEMPTS,
    VERSION_POLL_FAST_INTERVAL, VERSION_POLL_INTERVAL, controller_client, controller_url,
};
use super::controller_error_detail;
use super::failure::{
    NODE_OR_CORE_UNREACHABLE_PREFIX, TUN_DATA_PLANE_BROKEN_PREFIX, TUN_INGRESS_BROKEN_PREFIX,
    WFP_LOCK_UNVERIFIED_PREFIX, StageFailure,
};
use super::status::{log_current_stage_duration, set_stage};
use super::transaction::ConnectTransaction;

/// §6.8 exit probe target.
pub(super) const EXIT_PROBE_URL: &str = crate::tono::protected_probe::PROBE_ORIGINS[0].url;

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

/// Retained probe scheduling interval; the single Google target starts immediately.
pub(super) const TUN_PROBE_STAGGER: Duration = Duration::from_millis(100);

/// TUN and diagnostic loopback requests share the same gstatic HTTPS 204 contract.
/// WFP must still be Locked; a physical-interface fallback is not accepted.
pub(super) use crate::tono::protected_probe::{
    ProbeOrigin as TunDataPlaneProbe, PROBE_ORIGINS as TUN_DATA_PLANE_PROBES,
};

/// V1/H1 — §6.9 kill-switch verification retries. `KillSwitchStatus.live` on Windows is not a
/// live query: it is a ~1.5 s-decaying cache refreshed by a 1 s loop, so one slow-but-successful
/// verify reads `live: false` and fails a healthy tunnel. Every other stage retries (`lock` 50×,
/// `verify_fake_ip` 3×, `wait_controller` 64×); the only stage reading a
/// time-decayed field retried zero times. The window deliberately spans more than one full
/// refresh period, so the verdict is never decided by a single sample of a decaying value.
pub(super) const VERIFY_LOCK_ATTEMPTS: u32 = 4;

pub(super) const VERIFY_LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(700);

/// C3 — `checkingExit` + `verifyingTraffic` form one retryable *verification* group.
///
/// At that point the barrier is locked and the tunnel is proven up, but `session_verified` is
/// still false (it is committed only after both stages pass), so `plan_failure(armed = true,
/// session_verified = false, ..)` resolves to `FullRelease` — and `next_reconnect_delay()`
/// then requires `is_protection_blocked && session_verified`, both false, so nothing retries.
/// A controller delay result is only advisory; the real App data-plane request below owns the
/// verdict. A transient failure of that authoritative check still gets one full in-place retry.
///
/// The retry therefore belongs **before** the full release, inside the still-live transaction:
/// the decision table, the verification latch, and the release rules are untouched, and an
/// exhausted group still falls through to exactly the old `FullRelease`.
pub(super) const POST_LOCK_VERIFY_ROUNDS: u32 = 2;

pub(super) const POST_LOCK_VERIFY_ROUND_DELAY: Duration = Duration::from_millis(500);

/// Wait after the data plane is already proved before the advisory `/delay`.
/// The verdict does not wait. 1500 ms lets the first page open its own
/// handshakes; the probe itself is a second Reality connection.
pub(super) const ADVISORY_EXIT_PROBE_DEFER: Duration = Duration::from_millis(1500);

/// C3 — the post-lock verification group: an advisory controller delay check followed by the
/// authoritative real App data-plane check, retried up to [`POST_LOCK_VERIFY_ROUNDS`] times
/// inside the still-live transaction.
///
/// Why here and not in the failure path: by this point WFP is armed *and* locked and the tunnel
/// is proven up, but `session_verified` is committed only after both stages pass. A failure
/// therefore reaches `plan_failure(armed = true, session_verified = false, ..)` → `FullRelease`,
/// which destroys the tunnel — and `next_reconnect_delay()` then requires
/// `is_protection_blocked && session_verified`, both false afterwards, so nothing retries. A
/// single transient 504 on the exit probe took a working tunnel to NotConnected with no recovery.
///
/// Fail-closed is untouched: a controller `/delay` 504 is tolerated only if a fresh HTTPS request
/// from this App succeeds while WFP is locked and system DNS points into WinTUN. That is stronger
/// proof of user traffic than Mihomo's doubled synthetic measurement. Nothing here marks a
/// session verified until that proof passes, releases or weakens the barrier, or shortens any
/// release; an exhausted real-data-plane check still reaches the same `FullRelease`.
#[allow(clippy::too_many_arguments, reason = "stage helper mirrors run_stages' own context")]
pub(super) async fn verify_post_lock(
    state: &Arc<TonoState>,
    app: &AppHandle,
    secret: &str,
    controller_port: u16,
    mixed_port: u16,
    generation: u64,
    started: std::time::Instant,
    transaction: &ConnectTransaction,
) -> Result<KillSwitchStatus, StageFailure> {
    // §6.8 is one advisory measurement. It must not run beside the TUN probe:
    // unified-delay doubles `/delay`, and each sample is another Reality
    // handshake on the same exit. Success does not wait for it. That holds for
    // the success path and for round 1. The final round only exists after a
    // round-1 failure, so it starts the advisory sample beside the diagnostic
    // join: a failed connect then does not pay the 8 s advisory budget serially
    // after the data-plane budget.
    set_stage(state, app, ConnectStage::CheckingExit, generation, started).await?;
    let outcomes = {
        let inner = state.lock().await;
        if inner.connect_generation == generation {
            inner.attempt_history.current.as_ref().map(|attempt| attempt.probe_outcomes.clone())
        } else {
            None
        }
    };
    set_stage(state, app, ConnectStage::VerifyingTraffic, generation, started).await?;
    let mut last = String::from("post-lock verification did not run");
    for round in 0..POST_LOCK_VERIFY_ROUNDS {
        if round > 0 && state.lock().await.connect_generation != generation {
            return Err(StageFailure::Stale);
        }
        let final_round = round + 1 == POST_LOCK_VERIFY_ROUNDS;
        let tun_recorder = outcomes.as_ref().map(|outcomes| ProbeRecorder { round: round + 1, path: "tun", outcomes: outcomes.clone() });
        let proxy_recorder = outcomes.as_ref().map(|outcomes| ProbeRecorder { round: round + 1, path: "loopback", outcomes: outcomes.clone() });
        let measured_node = if final_round { state.lock().await.selected_node.clone() } else { None };
        let controller_recorder = outcomes.as_ref().map(|outcomes| ProbeRecorder {
            round: round + 1,
            path: "controller",
            outcomes: outcomes.clone(),
        });
        let (data_plane, proxy_cross_check, advisory) = if final_round {
            let outcome = transaction
                .wait("real TUN verification with proxy cross-check and advisory exit measurement",
                    verify_final_round(
                        verify_locked_data_plane(tun_recorder.as_ref()),
                        verify_mixed_proxy_data_plane(mixed_port, proxy_recorder.as_ref()),
                        async {
                            let began = std::time::Instant::now();
                            let result = probe_exit_once(secret, controller_port).await;
                            (result, began.elapsed().as_millis() as u64)
                        },
                    ),
                )
                .await?;
            (outcome.data_plane, outcome.proxy_cross_check, outcome.advisory)
        } else {
            (
                transaction
                    .wait("real TUN data-plane verification", verify_locked_data_plane(tun_recorder.as_ref()))
                    .await?,
                None,
                None,
            )
        };
        let data_plane_error = data_plane.as_ref().err().cloned();
        // `advisory` is only present when the data plane failed in the final round.
        let controller_probe = match advisory {
            None => Ok(()),
            Some((result, elapsed_ms)) => {
                if let Some(recorder) = controller_recorder {
                    recorder.record("Google", result.is_ok(), "advisory", None, elapsed_ms);
                }
                match result {
                    Ok(delay) => {
                        if delay > 0 {
                            if let Some(node) = measured_node.as_deref() {
                                let mut inner = state.lock().await;
                                inner.record_exit_delay(node, delay);
                            }
                        }
                        Ok(())
                    }
                    Err(error) => Err(error),
                }
            }
        };

        match classify_post_lock_verification(controller_probe.clone(), data_plane) {
            PostLockVerification::Verified {
                status,
                controller_warning,
            } => {
                if let Some(error) = controller_warning {
                    let error = audit::redact(&error);
                    logging!(
                        warn,
                        Type::Service,
                        "Tono: controller exit measurement degraded; real TUN data plane passed: {error}"
                    );
                    state.audit().log(AuditEvent::HealthProbeFail {
                        probe: "controllerExitAdvisory",
                        error,
                    });
                }
                // The data plane already succeeded. Wait before the advisory
                // sample so the first page does not share the tunnel with a
                // second Reality handshake. The UI still gets a delay.
                let delay_state = state.clone();
                let delay_secret = secret.to_string();
                let measured_node = state.lock().await.selected_node.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(ADVISORY_EXIT_PROBE_DEFER).await;
                    if delay_state.lock().await.connect_generation != generation {
                        return;
                    }
                    let Ok(delay) = probe_exit_once(&delay_secret, controller_port).await else {
                        return;
                    };
                    if delay == 0 {
                        return;
                    }
                    let mut inner = delay_state.lock().await;
                    if inner.connect_generation == generation {
                        if let Some(node) = measured_node.as_deref() {
                            inner.record_exit_delay(node, delay);
                        }
                    }
                });
                log_current_stage_duration(state, generation, started).await;
                return Ok(status);
            }
            PostLockVerification::Retry { error } => {
                last = match (proxy_cross_check, data_plane_error) {
                    (Some(proxy), Some(data_plane)) => {
                        classify_exhausted_data_plane(controller_probe, data_plane, proxy)
                    }
                    _ => error,
                };
            }
        }
        if final_round {
            break;
        }
        logging!(
            warn,
            Type::Service,
            "Tono: 隧道已锁定但验证未通过，重试验证阶段 ({}/{}): {last}",
            round + 1,
            POST_LOCK_VERIFY_ROUNDS
        );
        transaction
            .wait(
                "post-lock verification retry",
                tokio::time::sleep(POST_LOCK_VERIFY_ROUND_DELAY),
            )
            .await?;
    }
    Err(StageFailure::error(last))
}

/// Result of the final verification round.
pub(super) struct FinalRoundOutcome<T, A> {
    pub(super) data_plane: Result<T, String>,
    pub(super) proxy_cross_check: Option<Result<(), String>>,
    /// The advisory sample, present only when the data plane failed. On data-plane success it is
    /// dropped unused, so the verdict never depends on it.
    pub(super) advisory: Option<A>,
}

/// Run the authoritative data-plane proof with its loopback diagnostic and the advisory sample
/// at the same time, so a failed connect pays `max(data plane, advisory)` instead of their sum.
/// On data-plane success the advisory future is dropped (no detached request outlives the
/// proof), exactly as `verify_with_diagnostic` drops its diagnostic. The caller owns the
/// deadline and cancellation of all three futures.
pub(super) async fn verify_final_round<T, A>(
    authoritative: impl std::future::Future<Output = Result<T, String>>,
    diagnostic: impl std::future::Future<Output = Result<(), String>>,
    advisory: impl std::future::Future<Output = A>,
) -> FinalRoundOutcome<T, A> {
    let verify = tono_core::protected_connectivity::verify_with_diagnostic(authoritative, diagnostic);
    tokio::pin!(verify, advisory);
    tokio::select! {
        biased;
        (data_plane, proxy_cross_check) = &mut verify => {
            if data_plane.is_ok() {
                FinalRoundOutcome { data_plane, proxy_cross_check, advisory: None }
            } else {
                FinalRoundOutcome { data_plane, proxy_cross_check, advisory: Some(advisory.await) }
            }
        }
        sampled = &mut advisory => {
            let (data_plane, proxy_cross_check) = verify.await;
            let advisory = if data_plane.is_ok() { None } else { Some(sampled) };
            FinalRoundOutcome { data_plane, proxy_cross_check, advisory }
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum PostLockVerification<T> {
    Verified {
        status: T,
        controller_warning: Option<String>,
    },
    Retry {
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
        tono_core::PostLockDecision::Retry { error, .. } => PostLockVerification::Retry { error },
    }
}

pub(super) fn classify_exhausted_data_plane(
    controller_probe: Result<(), String>,
    data_plane: String,
    proxy_cross_check: Result<(), String>,
) -> String {
    // #593: the WFP lock proof failed before any TUN probe ran, so a TUN verdict (and its
    // "restart the PC" advice) would misstate the failure. Keep the Service's real answer.
    if data_plane.starts_with(WFP_LOCK_UNVERIFIED_PREFIX) {
        let proxy = match proxy_cross_check {
            Ok(()) => "passed".to_string(),
            Err(error) => error,
        };
        return format!("{data_plane}; loopback proxy: {proxy}");
    }
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
///
/// Encrypted DNS / DoH is the common real-machine failure: the system query never reaches
/// `198.18.0.2` because it left over HTTPS and WFP blocked it. The service pins DoH off and
/// installs an NRPT catch-all for the session; if that has not taken yet, an explicit query to
/// the TUN listener is the same path apps will use once NRPT is in force.
///
/// System DNS and TUN race: the first fake-ip wins. Waiting for a 2–5 s system timeout
/// *then* asking TUN is how Win10 Encrypted DNS turned a live listener into a Proton-unlike
/// pause, then `securingDNS` auto-fail.
pub(super) async fn verify_fake_ip() -> Result<(), String> {
    let mut last = String::from("no answer");
    for attempt in 0..VERIFY_ATTEMPTS {
        let lookup_timeout = fake_ip_attempt_timeout(attempt);
        #[cfg(windows)]
        match verify_fake_ip_windows_attempt(lookup_timeout).await {
            Ok("tun") => {
                logging!(
                    warn,
                    Type::Service,
                    "Tono: protected DNS returned fake-ip before system DNS; Encrypted DNS was likely bypassing the adapter"
                );
                return Ok(());
            }
            Ok(_) => return Ok(()),
            Err(err) => last = err,
        }
        #[cfg(not(windows))]
        {
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
        }
        if attempt + 1 < VERIFY_ATTEMPTS {
            tokio::time::sleep(VERIFY_RETRY_INTERVAL).await;
        }
    }
    Err(fake_ip_verification_error(&last))
}

/// First fake-ip from either source wins. `None` = still waiting.
pub(super) fn fake_ip_race_state(
    system: Option<&Result<Vec<std::net::Ipv4Addr>, String>>,
    tun: Option<&Result<std::net::Ipv4Addr, String>>,
) -> Option<Result<&'static str, String>> {
    if let Some(Ok(addrs)) = system {
        if addrs.iter().copied().any(|ip| is_fake_ip(IpAddr::V4(ip))) {
            return Some(Ok("system"));
        }
    }
    if let Some(Ok(ip)) = tun {
        if is_fake_ip(IpAddr::V4(*ip)) {
            return Some(Ok("tun"));
        }
    }
    match (system, tun) {
        (Some(system), Some(tun)) => {
            let mut last = match system {
                Ok(addrs) => format!("no fake-ip in {addrs:?}"),
                Err(err) => err.clone(),
            };
            last = match tun {
                Ok(ip) => format!("{last}; TUN DNS returned {ip}, not fake-ip"),
                Err(err) => format!("{last}; TUN DNS: {err}"),
            };
            Some(Err(last))
        }
        _ => None,
    }
}

#[cfg(windows)]
async fn verify_fake_ip_windows_attempt(
    lookup_timeout: Duration,
) -> Result<&'static str, String> {
    let system = crate::tono::windows_dns::query_a(FAKE_IP_LOOKUP_HOST, lookup_timeout);
    let tun = crate::tono::protected_probe::query_protected_a(FAKE_IP_LOOKUP_HOST);
    tokio::pin!(system);
    tokio::pin!(tun);
    let mut system_res = None;
    let mut tun_res = None;
    loop {
        if let Some(outcome) = fake_ip_race_state(system_res.as_ref(), tun_res.as_ref()) {
            return outcome;
        }
        tokio::select! {
            res = &mut system, if system_res.is_none() => {
                system_res = Some(res);
            }
            res = &mut tun, if tun_res.is_none() => {
                tun_res = Some(res);
            }
        }
    }
}

pub(super) fn tun_dns_proves_fake_ip(tun: Result<std::net::Ipv4Addr, &str>) -> bool {
    tun.ok().is_some_and(|ip| is_fake_ip(IpAddr::V4(ip)))
}

pub(super) fn fake_ip_verification_error(last: &str) -> String {
    let tun_dead = last.contains("TUN DNS:") || last.contains("loopback DNS:");
    let os_bypassed = last.contains("no fake-ip in") || last.contains("exceeded");
    if os_bypassed && !tun_dead {
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

/// One exit probe: `GET /proxies/Tono-Exit/delay` against the Google homepage with an
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
    let (secret, controller_port, measured_node) = {
        let inner = state.lock().await;
        if !inner.fsm.status().is_connected {
            return Err("connect before testing the current server".to_string());
        }
        let (secret, controller_port) = inner
            .controller_secret
            .clone()
            .zip(inner.controller_port)
            .ok_or_else(|| "connected controller endpoint is unavailable".to_string())?;
        (secret, controller_port, inner.selected_node.clone())
    };
    let delay = probe_exit_once(&secret, controller_port)
        .await
        .map_err(|error| format!("current server test failed: {error}"))?;
    {
        let mut inner = state.lock().await;
        if let Some(node) = measured_node.as_deref() {
            inner.record_exit_delay(node, delay);
        }
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
                last = kill_switch_not_locked(&status);
            }
            Err(err) => last = err.to_string(),
        }
        if attempt + 1 < VERIFY_LOCK_ATTEMPTS {
            tokio::time::sleep(VERIFY_LOCK_RETRY_INTERVAL).await;
        }
    }
    Err(lock_unverified_error(&last))
}

/// The Service's answer when it is not Locked, with its own `last_error`: without it a WFP
/// failure (reconciliation, engine timeout) reached the user as `live=false` and nothing more.
pub(super) fn kill_switch_not_locked(status: &KillSwitchStatus) -> String {
    let mut message = format!(
        "kill switch not locked (wanted={}, live={}, mode={:?})",
        status.wanted, status.live, status.mode
    );
    if let Some(error) = status.last_error.as_deref().filter(|error| !error.is_empty()) {
        message.push_str("; service last error: ");
        message.push_str(error);
    }
    message
}

/// #593: a failed lock proof is its own classification, never a TUN data-plane verdict.
pub(super) fn lock_unverified_error(last: &str) -> String {
    format!(
        "{WFP_LOCK_UNVERIFIED_PREFIX}: {last} (after {VERIFY_LOCK_ATTEMPTS} samples over {:?})",
        verify_lock_retry_window()
    )
}

/// The authoritative connection verdict: an ordinary fresh App flow must traverse the protected
/// Windows data plane. With WFP locked, a physical-interface fallback is blocked and only the
/// recorded WinTUN LUID is permitted, so a valid Google HTTPS 200 is evidence of tunnel traffic.
pub(super) async fn verify_locked_data_plane(recorder: Option<&ProbeRecorder>) -> Result<KillSwitchStatus, String> {
    let began = std::time::Instant::now();
    let status = verify_locked().await.map_err(|error| {
        if let Some(recorder) = recorder {
            recorder.record("WFP", false, "protection", None, began.elapsed().as_millis() as u64);
        }
        error
    })?;
    verify_tun_data_plane_observed(recorder).await?;
    Ok(status)
}

pub(super) async fn verify_tun_data_plane() -> Result<(), String> {
    verify_tun_data_plane_observed(None).await
}

/// Strict admission needs the Windows DNS Client's own result as well as the
/// listener/TUN TLS proof. A successful explicit listener must not mask NRPT,
/// GPO or OS DoH bypassing the protected resolver.
pub(super) async fn verify_three_tier_data_plane() -> Result<(), String> {
    #[cfg(windows)]
    {
        let addresses = crate::tono::windows_dns::query_a(FAKE_IP_LOOKUP_HOST, FAKE_IP_LOOKUP_TIMEOUT).await?;
        if !addresses.into_iter().any(|ip| is_fake_ip(IpAddr::V4(ip))) {
            return Err("three-tier requires a protected fake-IP answer from the Windows DNS Client".into());
        }
    }
    verify_tun_data_plane().await
}

pub(super) async fn verify_session_data_plane(state: &TonoState) -> Result<(), String> {
    let three_tier = state.lock().await.three_tier_routing;
    if three_tier { verify_three_tier_data_plane().await } else { verify_tun_data_plane().await }
}

/// Health only, never admission or a node-switch verdict. `Some` preserves the
/// cloud failure: a domestic proof says nothing about Home or cloud reachability.
pub(super) async fn verify_session_health(state: &TonoState) -> Result<Option<String>, String> {
    let (generation, controller_generation, strict) = {
        let inner = state.lock().await;
        (inner.connect_generation, inner.controller_generation, inner.three_tier_routing)
    };
    if !strict {
        return verify_tun_data_plane().await.map(|()| None);
    }
    let result = match verify_three_tier_data_plane().await {
        Ok(()) => Ok(None),
        Err(cloud) => verify_strict_domestic_data_plane().await
            .map(|()| Some(cloud.clone()))
            .map_err(|domestic| format!("cloud: {cloud}; domestic: {domestic}")),
    };
    let inner = state.lock().await;
    if inner.connect_generation != generation || inner.controller_generation != controller_generation
        || !inner.fsm.status().is_connected || inner.three_tier_routing != strict
    {
        return Err("session changed during health proof".into());
    }
    result
}

/// A fresh App DNS + TLS flow into WinTUN, not an IPC liveness claim. Resolve
/// only on protected DNS and pin that fake IP with the original TLS name; no
/// proxy, physical DNS, redirects, certificate bypass or new privileged grant.
/// A single unavailable domestic origin conservatively retains normal recovery.
async fn verify_strict_domestic_data_plane() -> Result<(), String> {
    const HOST: &str = "www.jd.com";
    // Ask the same compiled graph used by the runtime/Service, rather than
    // maintaining another domain classification or expanding the snapshot.
    let graph = tono_core::three_tier::graph(
        "Tono-Home-Residential", "Ethernet", "198.18.128.0/20",
    )?;
    let domestic = graph["route"]["rules"].as_array().is_some_and(|rules| rules.iter().any(|rule| {
        rule["outbound"] == tono_core::three_tier::DIRECT
            && rule["domain"].as_array().is_some_and(|hosts| hosts.iter().any(|host| host == HOST))
    }));
    if !domestic {
        return Err("domestic health origin is not in the compiled exact-host graph".into());
    }
    tokio::time::timeout(TUN_DATA_PLANE_TIMEOUT, async {
        verify_locked().await?;
        #[cfg(windows)]
        {
            let addresses = crate::tono::windows_dns::query_a(HOST, FAKE_IP_LOOKUP_TIMEOUT).await?;
            if !addresses.into_iter().any(|ip| is_fake_ip(IpAddr::V4(ip))) {
                return Err("domestic health requires protected Windows DNS".into());
            }
        }
        let fake_ip = crate::tono::protected_probe::query_dns_endpoint(
            crate::tono::protected_probe::PROTECTED_DNS, HOST,
        ).await?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(TUN_DATA_PLANE_CONNECT_TIMEOUT)
            .timeout(TUN_DATA_PLANE_TIMEOUT)
            .resolve(HOST, std::net::SocketAddr::new(IpAddr::V4(fake_ip), 443))
            .build().map_err(|error| error.to_string())?;
        let response = client.get("https://www.jd.com/").send().await
            .map_err(|error| format!("domestic TLS proof: {error}"))?;
        if response.status() != reqwest::StatusCode::OK {
            return Err(format!("domestic TLS origin answered {}", response.status()));
        }
        verify_locked().await?;
        Ok(())
    }).await.map_err(|_| "domestic health proof timed out".to_owned())?
}

async fn verify_tun_data_plane_observed(recorder: Option<&ProbeRecorder>) -> Result<(), String> {
    crate::tono::integration_profile::delay_remote_operation().await;
    crate::tono::protected_probe::verify_protected_origins(
        TUN_DATA_PLANE_CONNECT_TIMEOUT,
        TUN_DATA_PLANE_TIMEOUT,
        TUN_PROBE_STAGGER,
        recorder,
    )
    .await
    .map(|_| ())
    .map_err(|failures| crate::tono::protected_probe::format_failures(&failures))
}

/// Diagnostic-only App ingress through Mihomo's ephemeral loopback mixed listener. This bypasses
/// WinTUN but still uses the exact owned runtime, selected exit group, staged core, WFP endpoint
/// permit, and remote node. A success therefore isolates a Windows TUN/route failure; it is never
/// returned as a successful connection verdict.
pub(super) async fn verify_mixed_proxy_data_plane(mixed_port: u16, recorder: Option<&ProbeRecorder>) -> Result<(), String> {
    let proxy_url = format!("http://127.0.0.1:{mixed_port}");
    let proxy = reqwest::Proxy::all(&proxy_url)
        .map_err(|error| format!("cannot configure loopback diagnostic proxy: {error}"))?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(proxy)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(TUN_DATA_PLANE_CONNECT_TIMEOUT)
        .timeout(TUN_DATA_PLANE_TIMEOUT)
        .build()
        .map_err(|error| format!("cannot create loopback diagnostic proxy probe: {error}"))?;
    crate::tono::integration_profile::delay_remote_operation().await;

    race_data_plane_probes(&client, recorder).await.map_err(|failures| {
        format!(
            "all {} independent loopback-proxy probes failed: {}",
            TUN_DATA_PLANE_PROBES.len(),
            failures.join(" | ")
        )
    })
}

pub(super) fn tun_probe_stagger(index: usize) -> Duration {
    TUN_PROBE_STAGGER * (index as u32)
}

pub(super) async fn race_data_plane_probes(client: &reqwest::Client, recorder: Option<&ProbeRecorder>) -> Result<(), Vec<String>> {
    let mut in_flight = FuturesUnordered::new();
    for (index, probe) in TUN_DATA_PLANE_PROBES.into_iter().enumerate() {
        let client = client.clone();
        in_flight.push(async move {
            let delay = tun_probe_stagger(index);
            if !delay.is_zero() {
                tokio::time::sleep(delay).await;
            }
            probe_tun_endpoint(&client, probe, recorder).await
        });
    }

    let mut failures = Vec::with_capacity(TUN_DATA_PLANE_PROBES.len());
    while let Some(result) = in_flight.next().await {
        match result {
            Ok(()) => return Ok(()),
            Err(error) => failures.push(error),
        }
    }
    Err(failures)
}

pub(super) async fn probe_tun_endpoint(client: &reqwest::Client, probe: TunDataPlaneProbe, recorder: Option<&ProbeRecorder>) -> Result<(), String> {
    let began = std::time::Instant::now();
    let response = client
        .get(probe.url)
        .send()
        .await
        .map_err(|error| {
            if let Some(recorder) = recorder {
                recorder.record(probe.label, false, crate::tono::protected_probe::classify_reqwest(&error).as_str(), None, began.elapsed().as_millis() as u64);
            }
            format!("{} ({}): {}", probe.label, probe.url, describe_reqwest_error(&error))
        })?;
    let actual = response.status().as_u16();
    if let Some(recorder) = recorder {
        recorder.record(probe.label, actual == probe.expected_status, "http", Some(actual), began.elapsed().as_millis() as u64);
    }
    if actual == probe.expected_status {
        Ok(())
    } else {
        Err(format!(
            "{} ({}) answered {}, expected {}",
            probe.label, probe.url, actual, probe.expected_status
        ))
    }
}

pub(super) fn describe_reqwest_error(error: &reqwest::Error) -> String {
    let category = if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connect"
    } else {
        "request"
    };
    let mut parts = vec![format!("{category}: {error}")];
    let mut source = error.source();
    while let Some(cause) = source {
        let detail = cause.to_string();
        if !detail.is_empty() && parts.last().is_none_or(|last| last != &detail) {
            parts.push(detail);
        }
        if parts.len() == 5 {
            break;
        }
        source = cause.source();
    }
    let joined = parts.join(" -> ");
    controller_error_detail(&joined).unwrap_or_else(|| category.to_string())
}

#[cfg(test)]
mod advisory_delay_tests {
    #[test]
    fn advisory_exit_probe_waits_until_the_first_page_can_start() {
        assert_eq!(super::ADVISORY_EXIT_PROBE_DEFER.as_millis(), 1500);
    }
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
    use std::time::{Duration, Instant};

    use super::verify_final_round;

    #[test]
    fn advisory_exit_probe_waits_until_the_first_page_can_start() {
        assert_eq!(super::ADVISORY_EXIT_PROBE_DEFER.as_millis(), 1500);
    }

    #[tokio::test]
    async fn final_round_data_plane_success_does_not_use_or_wait_for_the_advisory_sample() {
        let began = Instant::now();
        let outcome = verify_final_round(
            async {
                tokio::time::sleep(Duration::from_millis(20)).await;
                Ok::<_, String>("verified")
            },
            async { Ok(()) },
            async {
                tokio::time::sleep(Duration::from_millis(400)).await;
                "advisory"
            },
        )
        .await;
        assert_eq!(outcome.data_plane, Ok("verified"));
        assert_eq!(outcome.advisory, None);
        assert!(began.elapsed() < Duration::from_millis(300), "waited for the advisory sample");
    }

    #[tokio::test]
    async fn final_round_data_plane_success_discards_an_advisory_sample_that_finished_first() {
        let outcome = verify_final_round(
            async {
                tokio::time::sleep(Duration::from_millis(60)).await;
                Ok::<_, String>("verified")
            },
            async { Ok(()) },
            async { "advisory failed" },
        )
        .await;
        assert_eq!(outcome.data_plane, Ok("verified"));
        assert_eq!(outcome.advisory, None);
    }

    #[tokio::test]
    async fn final_round_data_plane_failure_overlaps_the_advisory_sample() {
        let began = Instant::now();
        let outcome = verify_final_round(
            async {
                tokio::time::sleep(Duration::from_millis(60)).await;
                Err::<(), _>("tun failed".to_string())
            },
            async { Err("loopback failed".to_string()) },
            async {
                tokio::time::sleep(Duration::from_millis(80)).await;
                "advisory"
            },
        )
        .await;
        let elapsed = began.elapsed();
        assert_eq!(outcome.data_plane, Err("tun failed".to_string()));
        assert_eq!(outcome.proxy_cross_check, Some(Err("loopback failed".to_string())));
        assert_eq!(outcome.advisory, Some("advisory"));
        assert!(elapsed >= Duration::from_millis(80), "advisory result returned early: {elapsed:?}");
        assert!(elapsed < Duration::from_millis(120), "advisory ran after the data plane: {elapsed:?}");
    }

    #[tokio::test]
    async fn final_round_returns_the_advisory_sample_that_finished_before_a_failing_data_plane() {
        let outcome = verify_final_round(
            async {
                tokio::time::sleep(Duration::from_millis(80)).await;
                Err::<(), _>("tun failed".to_string())
            },
            async { Ok(()) },
            async {
                tokio::time::sleep(Duration::from_millis(10)).await;
                "advisory"
            },
        )
        .await;
        assert_eq!(outcome.data_plane, Err("tun failed".to_string()));
        assert_eq!(outcome.advisory, Some("advisory"));
    }
}
