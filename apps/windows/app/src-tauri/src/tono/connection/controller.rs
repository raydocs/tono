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

/// Every other controller call keeps the original general budget: `/version` polls are bounded
/// far tighter by `CONTROLLER_POLL_TIMEOUT`, and a cloud-policy `/dns/query` must not be able to
/// spend an exit-probe-sized slice of the transaction.
pub(super) const CONTROLLER_HTTP_TIMEOUT: Duration = Duration::from_secs(6);

/// Fail fast when BFE is known stopped. A query failure is not a refusal —
/// StartClash still diagnoses a wedged or missing engine. StartPending is
/// allowed through so a machine that is bringing BFE up is not rejected.
/// BFE's verdict for the service-readiness failure path, in the shape `map_wfp_engine_error`
/// already translates. `Ok(())` on any platform or condition where BFE is not the answer, so
/// the caller falls through to its own classification.
pub(super) fn blocking_bfe_verdict() -> Result<(), String> {
    #[cfg(windows)]
    {
        match query_bfe_state() {
            Ok((running, state)) if !running && !state.eq_ignore_ascii_case("StartPending") => {
                Err(format!("{BFE_NOT_RUNNING_PREFIX}: state {state}"))
            }
            _ => Ok(()),
        }
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

pub(super) async fn preflight_bfe() -> Result<(), String> {
    #[cfg(windows)]
    {
        match tokio::task::spawn_blocking(query_bfe_state).await {
            Ok(Ok((running, state))) => classify_bfe_state(running, &state),
            Ok(Err(_)) | Err(_) => Ok(()),
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
    service::tono_service_ready_or_repair()
        .await
        .map_err(|err| {
            // Ask BFE before answering. TonoService is AutoStart with a hard BFE dependency, so
            // when BFE is off the SCM refuses to start it and does not retry — a reboot does not
            // help either. `preflight_bfe` already knows how to say that, but it runs later in
            // the connect flow and this failure returns before it, so the customer used to get
            // "the Service is not ready" plus an internal error and no way forward.
            if let Err(bfe) = blocking_bfe_verdict() {
                return bfe;
            }
            map_service_ready_error(&err)
        })?;
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
        .put(&url)
        .bearer_auth(secret)
        .json(&serde_json::json!({ "name": name }))
        .send()
        .await
        .map_err(|error| format!("selector request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("selector returned {}", response.status()));
    }
    let body: serde_json::Value = client
        .get(&url)
        .bearer_auth(secret)
        .send()
        .await
        .map_err(|error| format!("selector readback failed: {error}"))?
        .json()
        .await
        .map_err(|error| format!("selector readback json: {error}"))?;
    let now = body.get("now").and_then(|value| value.as_str()).unwrap_or("");
    if now != name {
        return Err(format!("selector now={now:?} wanted {name:?}"));
    }
    Ok(())
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
            Ok(Ok(response)) if response.status().is_success() => return Ok(()),
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
    let mut last = String::from("no response");
    for attempt in 0..LOCK_ATTEMPTS {
        match service::tono_lock_kill_switch_for_session(session).await {
            Ok(()) => return Ok(()),
            Err(err) => {
                last = err.to_string();
                if !is_retryable_lock_error(&last) {
                    return Err(format!("kill switch lock failed: {last}"));
                }
                if attempt + 1 == LOCK_ATTEMPTS {
                    break;
                }
                tokio::time::sleep(LOCK_RETRY_INTERVAL).await;
            }
        }
    }
    Err(format!("kill switch lock failed (TUN adapter not ready?): {last}"))
}

/// Both inputs are read-only and cancellation-safe. A proven protected owner may
/// keep port 53 until replacement; do not wait for that known conflict to time out.
pub(super) async fn admit_dns_listener<D, R>(preflight: D, resume: R) -> Result<bool, String>
where D: std::future::Future<Output = Result<(), String>>,
      R: std::future::Future<Output = bool>,
{
    tokio::pin!(preflight, resume);
    tokio::select! {
        result = &mut preflight => match result {
            Ok(()) => Ok(false),
            Err(error) => if resume.await { Ok(true) } else { Err(error) },
        },
        protected_owner = &mut resume => {
            if protected_owner { Ok(true) } else { preflight.await.map(|()| false) }
        }
    }
}

#[cfg(test)]
mod dns_admission_tests {
    use super::*;
    #[tokio::test]
    async fn known_owner_does_not_wait_for_occupied_port_and_free_port_does_not_wait_for_owner() {
        assert_eq!(admit_dns_listener(std::future::pending(), async { true }).await, Ok(true));
        assert_eq!(admit_dns_listener(async { Ok(()) }, std::future::pending()).await, Ok(false));
    }
    #[tokio::test]
    async fn unproven_owner_never_bypasses_port_conflict() {
        assert!(admit_dns_listener(async { Err("occupied".into()) }, async { false }).await.is_err());
        assert_eq!(admit_dns_listener(async { Err("occupied".into()) }, async { true }).await, Ok(true));
    }
}
