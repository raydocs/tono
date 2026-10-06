//! Controller HTTP, port allocation, BFE/service readiness, and lock retries.

use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;
use tono_core::EXIT_GROUP_NAME;
use tono_core::config::RuntimePorts;
use tono_logging::{Type, logging};
use tono_plugin_core::{MihomoExt as _, models::Protocol};
use tono_service_protocol::{KillSwitchStatus, OwnerSessionProof};

use crate::core::service;
use crate::tono::{audit::AuditEvent, state::TonoState};
use super::failure::{BFE_NOT_RUNNING_PREFIX, SERVICE_TOO_OLD_PREFIX, is_retryable_lock_error, map_service_ready_error};

/// §6.4: controller readiness poll budget. Mihomo's controller is usually up within a few
/// hundred milliseconds, so the first polls run on a tight 50 ms grid before falling back to
/// the coarse 250 ms interval — the fixed grid alone overshot a typical readiness by ~200 ms.
/// The attempt count is sized so the 15 s deadline, not the counter, is the effective budget.
pub(super) const VERSION_POLL_ATTEMPTS: u32 = 64;

pub(super) const VERSION_POLL_FAST_ATTEMPTS: u32 = 8;

pub(super) const VERSION_POLL_FAST_INTERVAL: Duration = Duration::from_millis(50);

pub(super) const VERSION_POLL_INTERVAL: Duration = Duration::from_millis(250);

/// A localhost controller poll must never inherit the general 6 s HTTP timeout. Forty such
/// timeouts would turn the documented ~10 s readiness window into a multi-minute apparent hang.
pub(super) const CONTROLLER_POLL_TIMEOUT: Duration = Duration::from_millis(750);

pub(super) const CONTROLLER_READY_TIMEOUT: Duration = Duration::from_secs(15);

/// §6.5: TUN adapter / lock retry budget. The first WinTUN driver install
/// plus interface-alias propagation is slow (~10 s on real hardware, P0-12).
pub(super) const LOCK_ATTEMPTS: u32 = 50;

pub(super) const LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(200);

/// A local alias lookup on a blocking thread, no IPC: how often a waiting lock retry looks
/// for the tunnel adapter.
const TUNNEL_ADAPTER_POLL_INTERVAL: Duration = Duration::from_millis(20);

/// A lookup that takes longer than this is not asked again in this ladder, which then runs
/// on the fixed grid.
const TUNNEL_ADAPTER_LOOKUP_TIMEOUT: Duration = Duration::from_millis(100);

/// One start needs one early retry. An adapter that keeps appearing and vanishing gets no
/// more than this many before the ladder is back on the fixed grid.
const LOCK_EARLY_RETRIES: u32 = 3;

/// Every other controller call keeps the original general budget: `/version` polls are bounded
/// far tighter by `CONTROLLER_POLL_TIMEOUT`, and a cloud-policy `/dns/query` must not be able to
/// spend an exit-probe-sized slice of the transaction.
pub(super) const CONTROLLER_HTTP_TIMEOUT: Duration = Duration::from_secs(6);

/// Fail fast when BFE is known stopped. A query failure is not a refusal —
/// StartClash still diagnoses a wedged or missing engine. StartPending is
/// allowed through so a machine that is bringing BFE up is not rejected.
pub(super) async fn preflight_bfe() -> Result<(), String> {
    #[cfg(windows)]
    {
        match service::probe_service_state(|| query_bfe_state().map_err(anyhow::Error::msg)).await {
            Ok((running, state)) => classify_bfe_state(running, &state),
            Err(_) => Ok(()),
        }
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

pub(super) fn classify_bfe_state(running: bool, state: &str) -> Result<(), String> {
    if running || state.eq_ignore_ascii_case("StartPending") {
        Ok(())
    } else {
        Err(format!("{BFE_NOT_RUNNING_PREFIX}: state {state}"))
    }
}

#[cfg(windows)]
pub(super) fn query_bfe_state() -> Result<(bool, String), String> {
    use windows_service::service::{ServiceAccess, ServiceState};
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .map_err(|error| format!("cannot connect to the service control manager: {error}"))?;
    let service = manager
        .open_service("BFE", ServiceAccess::QUERY_STATUS)
        .map_err(|error| format!("cannot open the Base Filtering Engine: {error}"))?;
    let state = service
        .query_status()
        .map_err(|error| format!("cannot query the Base Filtering Engine: {error}"))?
        .current_state;
    Ok((state == ServiceState::Running, format!("{state:?}")))
}

/// Tono has no sidecar: the Service must be Ready and speak the kill switch
/// protocol (rev 5 arm/lock + rev 6 release, C1).
pub(super) async fn ensure_service_ready() -> Result<(), String> {
    // `tono_service_ready_or_repair`: an unprotected App quit stops the SCM service, so the
    // first connect afterwards revives it through the established install/repair entry.
    if let Err(err) = service::tono_service_ready_or_repair().await {
        // Ask BFE before answering. The Service has a hard BFE dependency, and a stopped
        // engine needs its existing specific diagnosis. An unproven or stalled read retains
        // the original readiness error without blocking the runtime's cancellation checks.
        preflight_bfe().await?;
        return Err(map_service_ready_error(&err));
    }
    match service::tono_probe_kill_switch_release_support().await {
        Ok(None) => Ok(()),
        // The detail carries both sides' epoch/revision. The old wording asserted "too old",
        // which `supports_client` cannot actually distinguish — it rejects a *newer* Service
        // just as flatly — so a mismatched pair used to be told to reinstall the wrong half.
        Ok(Some(detail)) => Err(format!(
            "{SERVICE_TOO_OLD_PREFIX}: Tono Service protocol does not match this App ({detail}); reinstall/repair the Tono Service from this installer"
        )),
        Err(err) => Err(format!("cannot query the Tono Service protocol: {err}")),
    }
}

pub(super) async fn select_exit_group(secret: &str, port: u16, name: &str) -> Result<(), String> {
    let client = controller_client(Duration::from_secs(3))?;
    let url = controller_url(port, &format!("/proxies/{EXIT_GROUP_NAME}"));
    let response = client
        .put(url)
        .bearer_auth(secret)
        .json(&serde_json::json!({ "name": name }))
        .send()
        .await
        .map_err(|error| format!("selector request failed: {error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("selector returned {}", response.status()))
    }
}

/// The controller HTTP client. C2: the total timeout is per call site, because one of them (the
/// exit probe) hands the *core* a budget of its own and must always outlast it — a client that
/// times out first throws away mihomo's diagnosis and reports a transport error instead.
pub(super) fn controller_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_millis(500))
        .timeout(timeout)
        .build()
        .map_err(|err| err.to_string())
}

pub(super) fn controller_url(port: u16, path: &str) -> String {
    format!("http://127.0.0.1:{port}{path}")
}

/// One GET `/connections`. Failures are swallowed: callers treat this as
/// instrumentation and must not stall a connect or disconnect on it.
pub(super) async fn fetch_connections(secret: &str, port: u16) -> Option<super::SampledConnections> {
    let client = controller_client(Duration::from_secs(2)).ok()?;
    let response = client
        .get(controller_url(port, "/connections"))
        .bearer_auth(secret)
        .send()
        .await
        .ok()?;
    response.json::<super::SampledConnections>().await.ok()
}

/// Activity close mutations are generation-bound and use the copied endpoint credentials. If a
/// recovery replaces the controller after this check, the request still targets the old loopback
/// port and can never close a connection on the new generation.
pub async fn close_owned_controller_connection(
    state: &Arc<TonoState>,
    expected_generation: u64,
    id: Option<&str>,
) -> Result<(), String> {
    let (secret, port) = {
        let inner = state.lock().await;
        if inner.controller_generation != expected_generation || !inner.fsm.status().is_connected {
            return Err("TONO_ACTIVITY_STALE: controller generation changed".to_string());
        }
        inner
            .controller_secret
            .clone()
            .zip(inner.controller_port)
            .ok_or_else(|| "TONO_ACTIVITY_UNAVAILABLE: controller is not available".to_string())?
    };

    let client = controller_client(Duration::from_secs(2))?;
    let mut url = reqwest::Url::parse(&controller_url(port, "/connections"))
        .map_err(|error| format!("TONO_ACTIVITY_UNAVAILABLE: invalid controller URL: {error}"))?;
    if let Some(id) = id {
        url.path_segments_mut()
            .map_err(|_| "TONO_ACTIVITY_UNAVAILABLE: invalid controller URL".to_string())?
            .push(id);
    }
    let response = client
        .delete(url)
        .bearer_auth(secret)
        .send()
        .await
        .map_err(|error| format!("TONO_ACTIVITY_UNAVAILABLE: close request failed: {error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "TONO_ACTIVITY_UNAVAILABLE: controller returned {}",
            response.status()
        ))
    }
}

pub(super) fn configure_owned_controller_for_ui(
    state: &Arc<TonoState>,
    app: &AppHandle,
    secret: &str,
    controller_port: u16,
) {
    let mihomo = app.mihomo();
    mihomo.update_external_host(Some("127.0.0.1"));
    mihomo.update_external_port(Some(controller_port));
    mihomo.update_secret(Some(secret));
    if let Err(error) = mihomo.update_protocol(Protocol::Http) {
        // Telemetry must never turn a fully verified tunnel into a failed connection. Keep the
        // product online and make the missing dashboard data diagnosable instead.
        logging!(
            warn,
            Type::Frontend,
            "Tono: failed to configure dashboard traffic telemetry: {error:#}"
        );
        // The app log this warning lands in is not the file that uploads, so this failure
        // used to be invisible to support. Put it where it can be read remotely.
        state.audit().log(AuditEvent::TelemetryConfigFail {
            error: format!("{error:#}"),
        });
    }
}

/// Pick two distinct unused loopback ports for this connection generation. Both binds stay live
/// until both port numbers have been observed, so the OS cannot hand the same ephemeral port to
/// the controller and the diagnostic proxy. They are intentionally released before Mihomo starts;
/// another process can theoretically win that narrow race, but Mihomo then fails immediately and
/// the absolute connection deadline handles it. Keeping either listener open would prevent the
/// child from binding on Windows.
pub(super) async fn allocate_runtime_ports() -> Result<RuntimePorts, String> {
    let controller = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|error| format!("cannot allocate loopback controller port: {error}"))?;
    let mixed = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|error| format!("cannot allocate loopback diagnostic proxy port: {error}"))?;
    let controller_port = controller
        .local_addr()
        .map_err(|error| format!("cannot inspect loopback controller port: {error}"))?
        .port();
    let mixed_port = mixed
        .local_addr()
        .map_err(|error| format!("cannot inspect loopback diagnostic proxy port: {error}"))?
        .port();
    drop((controller, mixed));
    if controller_port == 0 || mixed_port == 0 || controller_port == mixed_port {
        return Err("operating system returned an invalid runtime listener plan".to_string());
    }
    Ok(RuntimePorts {
        mixed_port,
        controller_port,
    })
}

/// Protected DNS requires Mihomo to own both TCP and UDP loopback:53. Fail before WFP is installed
/// when another resolver already owns either socket, avoiding a 45-second protected-offline mystery.
pub(super) fn dns_listener_conflict_message(tcp_error: Option<&str>, udp_error: Option<&str>) -> String {
    let mut failures = Vec::with_capacity(2);
    if let Some(error) = tcp_error {
        failures.push(format!("TCP: {error}"));
    }
    if let Some(error) = udp_error {
        failures.push(format!("UDP: {error}"));
    }
    let detail = if failures.is_empty() {
        "socket ownership could not be proven".to_owned()
    } else {
        failures.join("; ")
    };
    format!(
        "DNS port 127.0.0.1:53 is unavailable ({detail}). Another DNS or proxy process is using it; close that process and retry"
    )
}

#[cfg(windows)]
pub(super) async fn preflight_dns_listener() -> Result<(), String> {
    // A just-replaced core can hold 127.0.0.1:53 for a few hundred milliseconds
    // while its process exits (unclean app restart, stop-and-replace start), so
    // a one-shot bind test reports os error 10048 against a socket that is about
    // to be free. Wait it out briefly — still bounded so a genuinely squatted
    // port (another TUN proxy) fails fast with the same message.
    const ATTEMPTS: usize = 30;
    const INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);
    let mut last_error = dns_listener_conflict_message(None, None);
    for attempt in 0..ATTEMPTS {
        let tcp = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 53)).await;
        let udp = tokio::net::UdpSocket::bind((std::net::Ipv4Addr::LOCALHOST, 53)).await;
        match (tcp, udp) {
            (Ok(tcp), Ok(udp)) => {
                drop((tcp, udp));
                return Ok(());
            }
            (tcp, udp) => {
                let tcp_error = tcp.err().map(|error| error.to_string());
                let udp_error = udp.err().map(|error| error.to_string());
                last_error = dns_listener_conflict_message(
                    tcp_error.as_deref(),
                    udp_error.as_deref(),
                );
                if attempt + 1 < ATTEMPTS {
                    tokio::time::sleep(INTERVAL).await;
                }
            }
        }
    }
    Err(last_error)
}

#[cfg(not(windows))]
pub(super) async fn preflight_dns_listener() -> Result<(), String> {
    Ok(())
}

/// A strongly proven same-owner Core is admitted whatever the loopback:53 probe says, and it is
/// the expected owner of that socket, so the probe's bind retries stop as soon as this attempt's
/// resume status arrives as `Some` instead of spending ~3 s against it. A stopped probe never
/// proves the socket free; `None` still waits for the probe's verdict.
pub(super) async fn preflight_dns_listener_unless_resuming<T>(
    preflight: impl std::future::Future<Output = Result<(), String>>,
    resume: impl std::future::Future<Output = Option<T>>,
) -> (Result<(), String>, Option<T>) {
    tokio::pin!(preflight, resume);
    tokio::select! {
        status = &mut resume => match status {
            Some(status) => (
                Err("loopback:53 probe stopped; this attempt proved the active runtime that holds it".to_owned()),
                Some(status),
            ),
            None => (preflight.await, None),
        },
        verdict = &mut preflight => (verdict, resume.await),
    }
}

/// §6.4: poll the mihomo controller `/version` for at most 15 seconds. Each localhost request is
/// independently bounded as well, so a half-open socket cannot multiply the whole-stage budget.
pub(super) async fn wait_controller(secret: &str, controller_port: u16) -> Result<(), String> {
    let client = controller_client(CONTROLLER_HTTP_TIMEOUT)?;
    let url = controller_url(controller_port, "/version");
    let mut last = String::from("no response");
    let deadline = tokio::time::Instant::now() + CONTROLLER_READY_TIMEOUT;
    for attempt in 0..VERSION_POLL_ATTEMPTS {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(
            remaining.min(CONTROLLER_POLL_TIMEOUT),
            client.get(&url).bearer_auth(secret).send(),
        )
        .await
        {
            Ok(Ok(response)) if response.status().is_success() => {
                // Warm the exit DoH for the probe host while PF/WFP and the
                // system DNS switch are still in front of the data-plane
                // check. A failure here must not fail connect. The host is
                // FAKE_IP_LOOKUP_HOST / PROBE_ORIGINS[0]; imported from
                // probes.rs this module would cycle.
                let prefetch_secret = secret.to_string();
                tokio::spawn(async move {
                    let Ok(prefetch) = controller_client(Duration::from_secs(5)) else {
                        return;
                    };
                    let url = controller_url(
                        controller_port,
                        "/dns/query?name=www.google.com&type=A",
                    );
                    let _ = prefetch.get(url).bearer_auth(prefetch_secret).send().await;
                });
                return Ok(());
            },
            Ok(Ok(response)) => last = format!("controller answered {}", response.status()),
            Ok(Err(err)) => last = err.to_string(),
            Err(_) => last = format!("controller poll exceeded {CONTROLLER_POLL_TIMEOUT:?}"),
        }
        if attempt + 1 == VERSION_POLL_ATTEMPTS {
            break;
        }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        let interval = if attempt < VERSION_POLL_FAST_ATTEMPTS {
            VERSION_POLL_FAST_INTERVAL
        } else {
            VERSION_POLL_INTERVAL
        };
        tokio::time::sleep(remaining.min(interval)).await;
    }
    Err(format!("mihomo controller not ready: {last}"))
}

/// §6.5+§6.6: lock, retrying only while the TUN adapter comes up (≤ 50 × 200 ms between
/// retryable failures). Permanent lock errors fail immediately so a bad owner/WFP state does
/// not burn the connect transaction budget on 50 full lifecycle IPCs.
pub(super) async fn lock_kill_switch_with_retries(session: &OwnerSessionProof) -> Result<(), String> {
    lock_with_retries(
        || service::tono_lock_kill_switch_for_session(session),
        super::platform::tunnel_adapter_present,
    )
    .await
}

async fn lock_with_retries<Attempt, Failure, Present>(
    mut lock: impl FnMut() -> Attempt,
    mut adapter_present: impl FnMut() -> Present,
) -> Result<(), String>
where
    Attempt: std::future::Future<Output = Result<(), Failure>>,
    Failure: std::fmt::Display,
    Present: std::future::Future<Output = bool>,
{
    let mut last = String::from("no response");
    let mut early_retries = LOCK_EARLY_RETRIES;
    let mut lookup_answers = true;
    for attempt in 0..LOCK_ATTEMPTS {
        let adapter_was_absent =
            early_retries > 0 && !adapter_seen(&mut lookup_answers, &mut adapter_present).await;
        match lock().await {
            Ok(()) => return Ok(()),
            Err(err) => {
                last = err.to_string();
                if !is_retryable_lock_error(&last) {
                    return Err(format!("kill switch lock failed: {last}"));
                }
                if attempt + 1 == LOCK_ATTEMPTS {
                    break;
                }
                if wait_for_lock_retry(adapter_was_absent, &mut lookup_answers, &mut adapter_present).await {
                    early_retries -= 1;
                }
            }
        }
    }
    Err(format!("kill switch lock failed (TUN adapter not ready?): {last}"))
}

/// WIN-LOCK-RETRY-GRID: the lock can only succeed once WinTUN is registered, so a refused
/// attempt is repeated when the adapter appears instead of on the next 200 ms tick, and the
/// answer says whether it was. An adapter that was already there before the refusal explains
/// nothing: that retry keeps the whole interval, and so does one whose adapter never shows.
/// The Service still resolves and validates the LUID itself; this only chooses when to ask.
async fn wait_for_lock_retry<Present: std::future::Future<Output = bool>>(
    adapter_was_absent: bool,
    lookup_answers: &mut bool,
    adapter_present: &mut impl FnMut() -> Present,
) -> bool {
    if !adapter_was_absent {
        tokio::time::sleep(LOCK_RETRY_INTERVAL).await;
        return false;
    }
    let deadline = tokio::time::Instant::now() + LOCK_RETRY_INTERVAL;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return false;
        }
        if adapter_seen(lookup_answers, adapter_present).await {
            return true;
        }
        tokio::time::sleep(remaining.min(TUNNEL_ADAPTER_POLL_INTERVAL)).await;
    }
}

/// The App's own lookup must not hold the lock back: one that does not answer in time counts
/// as "not seen" and is not asked again, so a stalled IP Helper costs one timeout per ladder.
async fn adapter_seen<Present: std::future::Future<Output = bool>>(
    lookup_answers: &mut bool,
    adapter_present: &mut impl FnMut() -> Present,
) -> bool {
    if !*lookup_answers {
        return false;
    }
    match tokio::time::timeout(TUNNEL_ADAPTER_LOOKUP_TIMEOUT, adapter_present()).await {
        Ok(present) => present,
        Err(_) => {
            *lookup_answers = false;
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    /// WIN-RESUME-DNS-PROBE-WAIT: a relaunch over the preserved, proven Core waited out all 30
    /// loopback:53 bind retries (~3 s) against the socket that Core holds before an admission
    /// that the resume status alone decides.
    #[tokio::test(start_paused = true)]
    async fn proven_resume_stops_the_dns_listener_probe() {
        let held = || async {
            tokio::time::sleep(Duration::from_secs(3)).await;
            Err::<(), String>("held".to_owned())
        };
        let started = tokio::time::Instant::now();
        let (probe, resume) = super::preflight_dns_listener_unless_resuming(held(), async { Some(()) }).await;
        assert!(probe.is_err() && resume.is_some(), "a stopped probe never proves the socket free");
        assert!(started.elapsed() < Duration::from_millis(100));
        let (probe, resume) = super::preflight_dns_listener_unless_resuming(held(), async { None::<()> }).await;
        assert_eq!(probe, Err("held".to_owned()), "without a proven runtime the probe still gates");
        assert!(resume.is_none());
    }

    /// WIN-LOCK-RETRY-GRID: the Service refuses the lock until WinTUN is registered, and the
    /// App asked again only on a fixed 200 ms grid, so an adapter that appeared at 250 ms was
    /// locked at 400 ms.
    #[tokio::test(start_paused = true)]
    async fn lock_retry_follows_the_tunnel_adapter() {
        let started = tokio::time::Instant::now();
        let registered = move || started.elapsed() >= Duration::from_millis(250);
        let locked = super::lock_with_retries(
            || async move {
                if registered() { Ok(()) } else { Err("interface alias \"Tono\" did not resolve to a LUID") }
            },
            || async move { registered() },
        )
        .await;
        assert_eq!(locked, Ok(()));
        assert!(started.elapsed() < Duration::from_millis(300), "locked at {:?}", started.elapsed());
    }
}
