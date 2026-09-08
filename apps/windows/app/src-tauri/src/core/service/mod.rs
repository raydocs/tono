mod install;
use install::*;
mod owner;
use owner::*;
pub use install::{ServiceManager, ServicePrerequisites};
pub(crate) use install::{
    run_privileged_service_action, service_prerequisites, trusted_service_evidence,
};
#[cfg(windows)]
pub(crate) use install::tono_request_service_owner_goodbye;

#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::utils::dirs;
use crate::{
    config::Config,
    core::{
        CoreManager,
        handle::Handle,
        manager::RunningMode,
        owner_identity::current_owner_credentials,
        proxy_control,
        runstate::{
            OwnerRecoveryReason, OwnerSample, OwnerStep, OwnerWatch, PendingAction, RUN_STATE, ReadyWaitError,
            RunState, RunStateEnv, RunStateStore, ServiceHealth,
        },
        tray::Tray,
    },
    process::AsyncHandler,
};
use anyhow::{Context as _, Result, bail};
use tono_logging::{Type, logging};
#[cfg(target_os = "macos")]
use tono_service_protocol::MacosKillSwitchMode;
use tono_service_protocol::{
    DirectRuntimeReloadResult, DnsProtectionStatus, FinalizeDirectRuntimeReloadRequest, KillSwitchConfig,
    KillSwitchLockRequest, KillSwitchStatus, KillSwitchStatusMode, MacosProxyConfig, OwnerCredentials,
    OwnerSessionProof, ProxyApplyOutcome, RenewDirectRuntimeReloadRequest, ReplaceDirectEndpointsRequest,
    ReplaceProxyEndpointsRequest,
    RuntimeBundle, ServiceStatusSnapshot, StageRuntimeOutcome, StartClashRequest, StopClashOptions, WriterConfig,
};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
#[cfg(any(target_os = "macos", test))]
use std::path::Path;
use std::{
    borrow::Cow,
    env::current_exe,
    future::Future,
    path::PathBuf,
    process::Command as StdCommand,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

static OWNER_MONITOR_GENERATION: AtomicU64 = AtomicU64::new(0);
static ACTIVE_SERVICE_SESSION: Lazy<Mutex<Option<ActiveServiceSession>>> = Lazy::new(|| Mutex::new(None));

/// `mark verified` is session-gated but idempotent. A distant/loaded Windows machine can lose
/// one named-pipe response immediately after the Service committed it, so reconcile and retry
/// this one mutation explicitly instead of destroying an otherwise fully verified tunnel.
const MARK_VERIFIED_ATTEMPTS: u32 = 3;
const MARK_VERIFIED_RETRY_DELAY: Duration = Duration::from_millis(500);
/// Rev-10 DIRECT bracket mutations are idempotent. Replay once only when the transport response
/// is ambiguous; a Service refusal is authoritative and is never retried.
const DIRECT_MUTATION_ATTEMPTS: u32 = 2;
const DIRECT_MUTATION_RETRY_DELAY: Duration = Duration::from_millis(350);

/// The Service session that owns the running Core, and what that Service can do.
///
/// The capability is learned once, when the Core is started, and discarded with the session
/// rather than cached globally — it describes *the Service instance that owns this Core*, which
/// is the only scope where it is safe to act on. A Service upgraded underneath a running Core
/// does not silently gain abilities the Core it owns was not started under.
#[derive(Clone)]
struct ActiveServiceSession {
    proof: OwnerSessionProof,
    supports_runtime_staging: bool,
    supports_macos_kill_switch: bool,
    supports_direct_runtime_reload: bool,
}

fn generate_service_session_token() -> Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).context("failed to generate service owner session")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

pub(crate) fn active_service_session() -> Result<OwnerSessionProof> {
    ACTIVE_SERVICE_SESSION
        .lock()
        .as_ref()
        .map(|session| session.proof.clone())
        .context("service owner session is not active")
}

/// Capture the exact owner session that will own every operation in the rev-10 reload bracket.
/// Callers retain this proof rather than consulting the mutable global again after a node switch.
pub(crate) fn active_direct_runtime_reload_session() -> Result<OwnerSessionProof> {
    let sessions = ACTIVE_SERVICE_SESSION.lock();
    let session = sessions.as_ref().context("service owner session is not active")?;
    if !session.supports_direct_runtime_reload {
        bail!("active Tono Service session does not support fail-closed DIRECT runtime reload");
    }
    Ok(session.proof.clone())
}

fn active_service_supports_macos_kill_switch() -> bool {
    ACTIVE_SERVICE_SESSION
        .lock()
        .as_ref()
        .is_some_and(|session| session.supports_macos_kill_switch)
}

pub(crate) fn clear_active_service_session() {
    ACTIVE_SERVICE_SESSION.lock().take();
}

/// Ask the Service whether it speaks the staging half of the protocol.
///
/// A failure here is not a failure to start: it only costs the fast path, so it is reported as
/// "no" and logged rather than propagated.
async fn probe_runtime_staging_support() -> bool {
    match tono_service_protocol::get_version().await {
        Ok(response) if response.code == 0 => response
            .data
            .as_ref()
            .is_some_and(tono_service_protocol::ProtocolInfo::supports_runtime_staging),
        Ok(response) => {
            logging!(
                warn,
                Type::Service,
                "服务协议查询返回 {}: {}；配置变更将走重启路径",
                response.code,
                response.message
            );
            false
        }
        Err(error) => {
            logging!(
                warn,
                Type::Service,
                "无法查询服务协议版本: {error:#}；配置变更将走重启路径"
            );
            false
        }
    }
}

async fn probe_direct_runtime_reload_support() -> bool {
    matches!(
        tono_service_protocol::get_version().await,
        Ok(response)
            if response.code == 0
                && response
                    .data
                    .as_ref()
                    .is_some_and(tono_service_protocol::ProtocolInfo::supports_direct_runtime_reload)
    )
}

#[cfg(target_os = "macos")]
pub(crate) async fn preflight_macos_kill_switch() -> Result<()> {
    let version = tono_service_protocol::get_version()
        .await
        .context("无法查询 Tono Service 协议版本")?;
    let supported = version.code == 0
        && version
            .data
            .as_ref()
            .is_some_and(tono_service_protocol::ProtocolInfo::supports_macos_kill_switch_preflight);
    if !supported {
        bail!("当前 Tono Service 不支持 Kill Switch 预检，请先重新安装服务");
    }

    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::preflight_macos_kill_switch(&credentials)
        .await
        .context("无法连接到 Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    Ok(())
}

fn session_matches_status(proof: &OwnerSessionProof, is_active: bool, active_generation: Option<u64>) -> bool {
    is_active && active_generation == Some(proof.generation)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceStatus {
    Checking,
    Ready,
    NotInstalled,
    NeedsReinstall,
    InstallRequired,
    UninstallRequired,
    ReinstallRequired,
    ForceReinstallRequired,
    SidecarAllowed,
    Unavailable(String),
}

impl ServiceStatus {
    /// Flatten a Run State snapshot into the legacy single-slot status.
    ///
    /// Precedence mirrors what the single slot used to hold: a requested action shadows an
    /// accepted Sidecar, which shadows the last observation. Kept until the frontend seam
    /// moves to `RunState` wholesale.
    fn from_run_state(state: &RunState) -> Self {
        if let Some(action) = state.pending {
            return match action {
                PendingAction::Install => Self::InstallRequired,
                PendingAction::Uninstall => Self::UninstallRequired,
                PendingAction::Reinstall => Self::ReinstallRequired,
                PendingAction::ForceReinstall => Self::ForceReinstallRequired,
            };
        }
        if state.sidecar_allowed {
            return Self::SidecarAllowed;
        }
        match &state.health {
            ServiceHealth::Unknown => Self::Checking,
            ServiceHealth::Ready => Self::Ready,
            ServiceHealth::NotInstalled => Self::NotInstalled,
            ServiceHealth::VersionMismatch => Self::NeedsReinstall,
            ServiceHealth::Unavailable(reason) => Self::Unavailable(reason.clone()),
        }
    }
}



/// Stage the exact in-memory Tono runtime for a rev-10 DIRECT hot reload. Unlike the generic
/// configuration path, this function never interprets `RestartRequired` as permission to replace
/// the Core. The connection transaction owns that fail-closed decision.
pub(crate) async fn tono_stage_runtime_for_direct_reload(
    session: &OwnerSessionProof,
    runtime: &RuntimeBundle,
) -> Result<StageRuntimeOutcome> {
    let credentials = current_owner_credentials()?;
    let mut last_ambiguous = None;
    for attempt in 1..=DIRECT_MUTATION_ATTEMPTS {
        match tono_service_protocol::stage_runtime(&credentials, session, runtime).await {
            Ok(response) => {
                if response.code > 0 {
                    bail!(response.message);
                }
                if let Some(outcome) = response.data {
                    return Ok(outcome);
                }
                last_ambiguous = Some("Tono Service omitted the runtime staging result".to_owned());
            }
            Err(error) => {
                last_ambiguous = Some(format!("无法连接到Tono Service: {error:#}"));
            }
        }
        if attempt < DIRECT_MUTATION_ATTEMPTS {
            tokio::time::sleep(DIRECT_MUTATION_RETRY_DELAY).await;
        }
    }
    bail!(
        "DIRECT runtime staging remained ambiguous after replay: {}",
        last_ambiguous.unwrap_or_else(|| "no response".to_owned())
    )
}

async fn capture_generation_before<F, Fut, T>(generation: &AtomicU64, operation: F) -> (u64, T)
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = T>,
{
    let captured = generation.load(Ordering::Acquire);
    (captured, operation().await)
}

pub(crate) async fn get_clash_log_snapshot_by_service() -> Result<String> {
    let credentials = current_owner_credentials()?;
    let (generation, response) = capture_generation_before(&OWNER_MONITOR_GENERATION, || {
        tono_service_protocol::get_clash_log_snapshot(&credentials)
    })
    .await;
    let response = response.context("无法连接到Tono Service")?;
    if response.code > 0 {
        if response.code == tono_service_protocol::ServiceErrorCode::NotActive as u16 {
            recover_after_owner_loss(generation, OwnerRecoveryReason::Displaced).await;
        }
        bail!(response.message);
    }
    let encoded = response.data.context("服务未返回核心日志快照")?;
    if encoded.len() % 2 != 0 {
        bail!("服务返回了无效的核心日志快照");
    }
    let mut content = Vec::with_capacity(encoded.len() / 2);
    for offset in (0..encoded.len()).step_by(2) {
        content.push(u8::from_str_radix(&encoded[offset..offset + 2], 16).context("服务返回了无效的核心日志快照")?);
    }
    Ok(String::from_utf8_lossy(&content).into_owned())
}

/// 通过服务停止core
pub(super) async fn stop_core_by_service(release_kill_switch: bool) -> Result<()> {
    logging!(info, Type::Service, "通过服务停止核心 (IPC)");
    cancel_owner_monitors();

    let credentials = match current_owner_credentials() {
        Ok(credentials) => credentials,
        Err(error) => {
            start_owner_monitor();
            return Err(error);
        }
    };
    let session = match active_service_session() {
        Ok(session) => session,
        Err(error) => {
            start_owner_monitor();
            return Err(error);
        }
    };
    let response = match if active_service_supports_macos_kill_switch() {
        tono_service_protocol::stop_clash_with_options(
            &credentials,
            &session,
            StopClashOptions { release_kill_switch },
        )
        .await
    } else {
        tono_service_protocol::stop_clash(&credentials, &session).await
    } {
        Ok(response) => response,
        Err(error) => {
            start_owner_monitor();
            return Err(error).context("无法连接到Tono Service");
        }
    };

    if response.code > 0 {
        if matches!(
            response.code,
            code if code == tono_service_protocol::ServiceErrorCode::NotActive as u16
                || code == tono_service_protocol::ServiceErrorCode::StaleOwnerSession as u16
        ) {
            recover_after_owner_loss_while_locked(OwnerRecoveryReason::Displaced).await;
        } else {
            start_owner_monitor();
        }
        let err_msg = response.message;
        logging!(error, Type::Service, "停止核心失败: {}", err_msg);
        bail!(err_msg);
    }

    clear_active_service_session();
    logging!(info, Type::Service, "服务成功停止核心");
    Ok(())
}

// ---- Tono product layer (crate::tono) ----
//
// The Tono connect orchestration drives the Service through the same owner/session machinery as
// the legacy flows above; these wrappers only differ in the payload they carry (owned runtime +
// Windows kill switch) and in always speaking the protocol rev 5 options.

/// Reconcile stale copies of Tono's installed Core before the App binds loopback DNS as an
/// availability proof. The privileged Service preserves only a fully verified protected runtime;
/// it stops weaker supervised/recorded instances and validates canonical image paths for the
/// orphan sweep. The App never enumerates or terminates processes itself.
pub(crate) async fn tono_prepare_core_start() -> Result<u32> {
    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::prepare_core_start(&credentials)
        .await
        .context("无法连接到 Tono Service 以准备核心")?;
    if response.code > 0 {
        bail!(response.message);
    }
    response.data.context("Tono Service 未返回核心准备结果")
}

/// Core binary path for the Tono owned runtime: the same mihomo build the Service runs.
pub(crate) async fn tono_core_binary_path() -> Result<PathBuf> {
    let bin_ext = if cfg!(windows) { ".exe" } else { "" };
    // The managed Tono product has one audited data-plane binary. A legacy Verge setting must not
    // silently select the alpha sidecar, which would also force every installer to ship two cores.
    service_core_path("tono-core", bin_ext)
}

/// Whether the Tono Service is installed, running, and protocol-compatible.
///
/// Tono has no sidecar fallback: anything but `Ready` is a hard error for the connect flow.
pub(crate) async fn tono_service_ready() -> Result<()> {
    SERVICE_MANAGER.refresh().await?;
    match SERVICE_MANAGER.current().await {
        ServiceStatus::Ready => Ok(()),
        status => bail!("Tono Service 不可用: {status:?}"),
    }
}

/// Ready check for the connect flow, with one recovery attempt.
///
/// Since an unprotected App quit now stops the SCM service, a registered-but-unavailable Service
/// is the expected state on the next connect, not a broken install. Revive it through the
/// established elevated install/repair entry (`PendingAction::Install` → `tono-service-install`
/// stops/reconfigures/starts the service idempotently), then re-check readiness. Every other
/// failure is returned untouched.
pub(crate) async fn tono_service_ready_or_repair() -> Result<()> {
    match tono_service_ready().await {
        Ok(()) => Ok(()),
        Err(error) => {
            let cause = format!("{error:#}");
            if !service_repair_is_worth_prompting(&cause) {
                logging!(
                    info,
                    Type::Service,
                    "Tono: 相同故障的提权修复刚刚失败过，本次直接返回原错误，不再弹出管理员提示: {cause}"
                );
                return Err(error);
            }
            match repair_registered_stopped_service().await {
                ServiceRepairAttempt::Skipped => Err(error),
                ServiceRepairAttempt::Ran => {
                    let recovered = tono_service_ready().await;
                    record_service_repair(&cause, recovered.is_ok());
                    recovered
                }
                ServiceRepairAttempt::Failed => {
                    record_service_repair(&cause, false);
                    Err(error)
                }
            }
        }
    }
}

/// The same readiness check for a path the user asked for: the Repair control, and the explicit
/// release that gives a blocked machine its Internet back.
///
/// A person acting on the failure is evidence the record cannot hold — they may be standing at
/// the machine ready to approve the prompt they declined a minute ago — so the backoff that
/// stops the unattended repetition never applies here.
pub(crate) async fn tono_service_ready_or_repair_now() -> Result<()> {
    forget_failed_service_repair();
    tono_service_ready_or_repair().await
}

/// Drop the record, so the next readiness failure is answered with a prompt again.
fn forget_failed_service_repair() {
    *LAST_FAILED_SERVICE_REPAIR.lock() = None;
}

/// What one attempt at the privileged install/repair entry achieved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ServiceRepairAttempt {
    /// Not attempted, and nothing was shown to the user: the Service is not registered, so an
    /// install is a separate, user-authorised decision.
    Skipped,
    /// The privileged entry ran to completion; readiness is re-checked by the caller.
    Ran,
    /// The privileged entry itself failed — the elevation prompt was declined, the installer
    /// returned an error, or the operation slot was busy.
    Failed,
}

/// The last elevated repair that did not leave the Service Ready, and the readiness failure it
/// was answering.
static LAST_FAILED_SERVICE_REPAIR: Lazy<Mutex<Option<FailedServiceRepair>>> = Lazy::new(|| Mutex::new(None));

struct FailedServiceRepair {
    cause: String,
    at: std::time::Instant,
}

/// How long a repair that did not fix the Service silences the next repair for the same failure.
///
/// Deliberately far longer than any connect or reconnect rung: the point is that a machine whose
/// install the repair cannot fix is asked once, not once per attempt.
const SERVICE_REPAIR_RETRY_BACKOFF: Duration = Duration::from_secs(60 * 60);

/// Whether the prompting repair path is worth entering for this readiness failure.
///
/// The repair shows a UAC prompt, and the protected reconnect ladder re-enters the connect flow
/// on every rung, so an install the repair cannot fix used to ask the user to approve an
/// administrator prompt on every rung too. A repair that ran and left the Service exactly as
/// unavailable as before is evidence about *that* failure: the identical one does not earn a
/// second prompt until [`SERVICE_REPAIR_RETRY_BACKOFF`] has passed. Any other failure, and any
/// failure at all once a repair has worked, is admitted immediately — a Service stopped by an
/// unprotected quit still revives on the next connect with no user action.
fn service_repair_is_worth_prompting(cause: &str) -> bool {
    LAST_FAILED_SERVICE_REPAIR
        .lock()
        .as_ref()
        .is_none_or(|last| last.cause != cause || last.at.elapsed() >= SERVICE_REPAIR_RETRY_BACKOFF)
}

/// Record what an attempted repair achieved. Success forgets everything: the next distinct
/// outage starts from a clean slate.
fn record_service_repair(cause: &str, recovered: bool) {
    *LAST_FAILED_SERVICE_REPAIR.lock() = (!recovered).then(|| FailedServiceRepair {
        cause: cause.to_owned(),
        at: std::time::Instant::now(),
    });
}

/// One attempt to revive a Service that is registered with the SCM but not answering, via the
/// established privileged install/repair path. Anything but [`ServiceRepairAttempt::Ran`] leaves
/// the caller on its original error path.
#[cfg(windows)]
async fn repair_registered_stopped_service() -> ServiceRepairAttempt {
    if !trusted_service_evidence().unwrap_or(false) {
        return ServiceRepairAttempt::Skipped;
    }
    logging!(
        info,
        Type::Service,
        "Tono: 服务已注册但未运行（上次未连接退出时所停），经 install/repair 入口拉起"
    );
    match SERVICE_MANAGER
        .handle_service_status(ServiceStatus::InstallRequired)
        .await
    {
        Ok(()) => ServiceRepairAttempt::Ran,
        Err(error) => {
            logging!(
                warn,
                Type::Service,
                "Tono: 停止状态服务的修复拉起失败: {error:#}"
            );
            ServiceRepairAttempt::Failed
        }
    }
}

#[cfg(not(windows))]
async fn repair_registered_stopped_service() -> ServiceRepairAttempt {
    ServiceRepairAttempt::Skipped
}

/// Whether the installed Service has the complete Windows protection contract: WFP + DNS,
/// owner-gated release, the durable verified-session marker, **and** the current system-safety
/// floor (`MIN_REQUIRED_SERVICE_REVISION`). Feature-only checks (rev ≥ 5/6/8) are not enough —
/// a Test 5 Service already had those bits but still freezes status behind the lifecycle lock
/// and uses the old DNS restore semantics. Pairing a new App with that Service after a failed
/// installer replacement must fail closed here, not during a half-armed connect.
/// Whether the installed Service speaks the kill-switch protocol this client needs.
///
/// Returns `None` when it does, and the *reason* when it does not. `supports_client` is false in
/// both directions — an epoch newer than ours fails it exactly like an older one — so a caller
/// holding only a bool can do nothing but guess, and guessing "too old" tells a user with a
/// newer Service to reinstall the thing that is already ahead. The detail comes from
/// `classify_service_version_reply`, which prints both sides' numbers.
pub(crate) async fn tono_probe_kill_switch_release_support() -> Result<Option<String>> {
    let response = tono_service_protocol::get_version()
        .await
        .context("无法连接到 Tono Service")?;
    let supported = response.code == 0
        && response.data.as_ref().is_some_and(|info| {
            info.supports_client(
                tono_service_protocol::ProtocolVersion::current(),
                tono_service_protocol::MIN_REQUIRED_SERVICE_REVISION,
            ) && tono_service_protocol::ProtocolInfo::supports_windows_kill_switch(info)
                && tono_service_protocol::ProtocolInfo::supports_kill_switch_release(info)
                && tono_service_protocol::ProtocolInfo::supports_kill_switch_verification(info)
                && tono_service_protocol::ProtocolInfo::supports_direct_runtime_reload(info)
        });
    if supported {
        return Ok(None);
    }
    // Reuse Run State's classifier so the App has exactly one wording for a protocol mismatch.
    let reply = crate::core::runstate::ServiceVersionReply {
        code: response.code,
        message: response.message,
        protocol: response.data,
    };
    let detail = match crate::core::runstate::classify_service_version_reply(&reply) {
        crate::core::runstate::ServiceVersionCheck::NeedsReinstall(detail) => detail,
        // The version handshake is acceptable, so what failed is one of the kill-switch
        // capability bits: an in-epoch Service that predates them.
        crate::core::runstate::ServiceVersionCheck::Ready => {
            "Service does not expose the Windows kill-switch arm/lock/release/verify/DIRECT-reload operations"
                .to_owned()
        }
    };
    Ok(Some(detail))
}

/// Start the core with the Tono owned runtime and the WFP bootstrap kill switch.
///
/// The Service persists intent, arms the bootstrap policy (block all + Mihomo endpoint permit +
/// bounded API channel), writes the runtime copy, and starts the verified core; a failure
/// anywhere in that sequence is fail-closed on the Service side. Mirrors
/// `start_with_existing_service` so the owner session, the owner monitor, and the Run State all
/// observe the Tono core exactly like a legacy one.
pub(crate) async fn tono_start_core_with_kill_switch(
    runtime: RuntimeBundle,
    kill_switch: KillSwitchConfig,
) -> Result<()> {
    logging!(info, Type::Service, "Tono: 通过服务启动核心并 arm Kill Switch");
    // Cancel the previous start's owner monitor before the session is cleared, exactly as
    // `tono_stop_core` does. Between this line and `adopt_tono_service_session` the Service
    // truthfully answers "not your session", and a monitor still ticking in that window reads
    // its own successor's handoff as displacement and runs the full owner-loss recovery —
    // stopping the proxy guard and resetting the system proxy — while this StartClash is in
    // flight. A connect with a cloud policy passes through this window twice.
    cancel_owner_monitors();
    clear_active_service_session();

    let credentials = current_owner_credentials()?;
    // A lost StartClash response is ambiguous: the Service may already have committed the new
    // owner session. Capture the prior generation so a fresh post-error generation can be safely
    // adopted with the proposed token instead of leaving a running Core that this App cannot stop.
    let generation_before = tono_active_generation(&credentials).await.ok();
    let proposed_session_token = generate_service_session_token()?;
    let request = StartClashRequest {
        runtime,
        proposed_session_token: proposed_session_token.clone(),
        macos_proxy: None,
        kill_switch: None,
        windows_kill_switch: Some(kill_switch),
    };

    let response = match tono_service_protocol::start_clash(&credentials, &request).await {
        Ok(response) => response,
        Err(error) => {
            if let Some(generation) = reconcile_lost_tono_start(&credentials, generation_before).await {
                adopt_tono_service_session(generation, proposed_session_token).await;
                logging!(
                    warn,
                    Type::Service,
                    "Tono: StartClash response was lost, but Service generation {generation} proves the start committed"
                );
                return Ok(());
            }
            start_owner_monitor();
            return Err(error).context("无法连接到Tono Service");
        }
    };

    if response.code > 0 {
        let err_msg = response.message;
        logging!(error, Type::Service, "Tono: 启动核心失败: {}", err_msg);
        start_owner_monitor();
        bail!(err_msg);
    }

    let Some(result) = response.data else {
        if let Some(generation) = reconcile_lost_tono_start(&credentials, generation_before).await {
            adopt_tono_service_session(generation, proposed_session_token).await;
            logging!(
                warn,
                Type::Service,
                "Tono: StartClash omitted its response body, but Service generation {generation} proves the start committed"
            );
            return Ok(());
        }
        start_owner_monitor();
        bail!("Tono Service 未返回会话信息");
    };
    adopt_tono_service_session(result.session.generation, proposed_session_token).await;
    logging!(info, Type::Service, "Tono: 服务成功启动核心");
    Ok(())
}

async fn tono_active_generation(credentials: &OwnerCredentials) -> Result<Option<u64>> {
    let response = tono_service_protocol::get_status(credentials)
        .await
        .context("无法查询 Tono Service 状态")?;
    if response.code > 0 {
        bail!(response.message);
    }
    let status = response.data.context("Tono Service 未返回状态快照")?;
    Ok(status.is_active.then_some(status.active_generation).flatten())
}

/// Prove that an ambiguous StartClash advanced the owner generation. `None` means no proof: an
/// already-active prior generation must never be paired with the new request's session token.
async fn reconcile_lost_tono_start(
    credentials: &OwnerCredentials,
    generation_before: Option<Option<u64>>,
) -> Option<u64> {
    let after = tono_active_generation(credentials).await.ok()??;
    advanced_tono_generation(generation_before, Some(after))
}

fn advanced_tono_generation(generation_before: Option<Option<u64>>, generation_after: Option<u64>) -> Option<u64> {
    let before = generation_before?;
    let after = generation_after?;
    (Some(after) != before).then_some(after)
}

async fn adopt_tono_service_session(generation: u64, proposed_session_token: String) {
    let supports_runtime_staging = probe_runtime_staging_support().await;
    let supports_direct_runtime_reload = probe_direct_runtime_reload_support().await;
    *ACTIVE_SERVICE_SESSION.lock() = Some(ActiveServiceSession {
        proof: OwnerSessionProof {
            generation,
            token: proposed_session_token,
        },
        supports_runtime_staging,
        supports_macos_kill_switch: false,
        supports_direct_runtime_reload,
    });

    start_owner_monitor();
    CoreManager::global().core_started(RunningMode::Service);
}

/// Stop the Tono core, always speaking the rev 5 stop options.
///
/// `release_kill_switch = false` keeps the WFP policy armed (fail-closed reconnect path);
/// `true` is one of the three releasing causes (Disconnect / Sign Out / Quit).
pub(crate) async fn tono_stop_core(release_kill_switch: bool) -> Result<()> {
    logging!(
        info,
        Type::Service,
        "Tono: 通过服务停止核心 (release_kill_switch={release_kill_switch})"
    );
    cancel_owner_monitors();

    let credentials = current_owner_credentials()?;
    let session = active_service_session()?;
    let response = tono_service_protocol::stop_clash_with_options(
        &credentials,
        &session,
        StopClashOptions { release_kill_switch },
    )
    .await
    .context("无法连接到Tono Service")?;

    if response.code > 0 {
        if matches!(
            response.code,
            code if code == tono_service_protocol::ServiceErrorCode::NotActive as u16
                || code == tono_service_protocol::ServiceErrorCode::StaleOwnerSession as u16
        ) {
            recover_after_owner_loss_while_locked(OwnerRecoveryReason::Displaced).await;
        } else {
            start_owner_monitor();
        }
        let err_msg = response.message;
        logging!(error, Type::Service, "Tono: 停止核心失败: {}", err_msg);
        bail!(err_msg);
    }

    clear_active_service_session();
    CoreManager::global().core_stopped();
    logging!(info, Type::Service, "Tono: 服务成功停止核心");
    Ok(())
}

/// `GET /kill-switch/status` (session owner required): which arm phase is live.
pub(crate) async fn tono_kill_switch_status() -> Result<KillSwitchStatus> {
    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::get_kill_switch_status(&credentials)
        .await
        .context("无法连接到Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    response.data.context("Tono Service 未返回 Kill Switch 状态")
}

/// Enter the fail-closed half of the rev-10 reload bracket with one captured owner session.
pub(crate) async fn tono_begin_direct_runtime_reload(session: &OwnerSessionProof) -> Result<DirectRuntimeReloadResult> {
    let credentials = current_owner_credentials()?;
    let mut last_ambiguous = None;
    for attempt in 1..=DIRECT_MUTATION_ATTEMPTS {
        match tono_service_protocol::begin_direct_runtime_reload(&credentials, session).await {
            Ok(response) => {
                if response.code > 0 {
                    bail!(response.message);
                }
                if let Some(result) = response.data {
                    return Ok(result);
                }
                last_ambiguous = Some("Tono Service omitted the DIRECT begin proof".to_owned());
            }
            Err(error) => {
                last_ambiguous = Some(format!("无法连接到Tono Service: {error:#}"));
            }
        }
        if attempt < DIRECT_MUTATION_ATTEMPTS {
            tokio::time::sleep(DIRECT_MUTATION_RETRY_DELAY).await;
        }
    }
    bail!(
        "DIRECT begin remained ambiguous after replay: {}",
        last_ambiguous.unwrap_or_else(|| "no response".to_owned())
    )
}

pub(crate) async fn tono_replace_proxy_endpoints(
    session: &OwnerSessionProof,
    proxy_endpoints: Vec<tono_service_protocol::ProxyEndpoint>,
) -> Result<()> {
    let credentials = current_owner_credentials()?;
    let request = ReplaceProxyEndpointsRequest { proxy_endpoints };
    match tono_service_protocol::replace_proxy_endpoints(&credentials, session, request).await {
        Ok(response) if response.code > 0 => bail!(response.message),
        Ok(_) => Ok(()),
        Err(error) => Err(error).context("无法连接到Tono Service"),
    }
}

/// Atomically commit the complete exact DIRECT endpoint set with one captured owner session.
pub(crate) async fn tono_replace_direct_endpoints(
    session: &OwnerSessionProof,
    reload_id: u64,
    direct_endpoints: Vec<tono_service_protocol::ProxyEndpoint>,
    reviewed_direct_ports: Vec<u16>,
) -> Result<DirectRuntimeReloadResult> {
    let credentials = current_owner_credentials()?;
    let request = ReplaceDirectEndpointsRequest {
        reload_id,
        direct_endpoints,
        // Declared only when this plan actually emitted process-scoped rules. An empty
        // declaration means the Service renders no reviewed-port permit, which is the correct
        // answer for a plan whose every route is an exact pin.
        reviewed_direct_ports,
    };
    let mut last_ambiguous = None;
    for attempt in 1..=DIRECT_MUTATION_ATTEMPTS {
        match tono_service_protocol::replace_direct_endpoints(&credentials, session, request.clone()).await {
            Ok(response) => {
                if response.code > 0 {
                    bail!(response.message);
                }
                if let Some(result) = response.data {
                    return Ok(result);
                }
                last_ambiguous = Some("Tono Service omitted the DIRECT endpoint commit proof".to_owned());
            }
            Err(error) => {
                last_ambiguous = Some(format!("无法连接到Tono Service: {error:#}"));
            }
        }
        if attempt < DIRECT_MUTATION_ATTEMPTS {
            tokio::time::sleep(DIRECT_MUTATION_RETRY_DELAY).await;
        }
    }
    bail!(
        "DIRECT endpoint commit remained ambiguous after replay: {}",
        last_ambiguous.unwrap_or_else(|| "no response".to_owned())
    )
}

/// Finalize the Service-owned pending DIRECT lease after all post-install proofs. Replaying the
/// same bracket/digest is idempotent, which closes the lost-response window without authorizing a
/// stale App transaction to modify a newer bracket.
pub(crate) async fn tono_finalize_direct_runtime_reload(
    session: &OwnerSessionProof,
    reload_id: u64,
    endpoint_digest: &str,
) -> Result<DirectRuntimeReloadResult> {
    let credentials = current_owner_credentials()?;
    let request = FinalizeDirectRuntimeReloadRequest {
        reload_id,
        endpoint_digest: endpoint_digest.to_owned(),
    };
    let mut last_ambiguous = None;
    for attempt in 1..=DIRECT_MUTATION_ATTEMPTS {
        match tono_service_protocol::finalize_direct_runtime_reload(&credentials, session, request.clone()).await {
            Ok(response) => {
                if response.code > 0 {
                    bail!(response.message);
                }
                if let Some(result) = response.data {
                    return Ok(result);
                }
                last_ambiguous = Some("Tono Service omitted the DIRECT finalize proof".to_owned());
            }
            Err(error) => {
                last_ambiguous = Some(format!("无法连接到Tono Service: {error:#}"));
            }
        }
        if attempt < DIRECT_MUTATION_ATTEMPTS {
            tokio::time::sleep(DIRECT_MUTATION_RETRY_DELAY).await;
        }
    }
    bail!(
        "DIRECT finalize remained ambiguous after replay: {}",
        last_ambiguous.unwrap_or_else(|| "no response".to_owned())
    )
}

/// Renew an already-finalized DIRECT lease. The Service accepts only the captured owner session,
/// reload id, and endpoint digest; replay is idempotent and no endpoint set is widened here.
pub(crate) async fn tono_renew_direct_runtime_reload(
    session: &OwnerSessionProof,
    reload_id: u64,
    endpoint_digest: &str,
) -> Result<DirectRuntimeReloadResult> {
    let credentials = current_owner_credentials()?;
    let request = RenewDirectRuntimeReloadRequest {
        reload_id,
        endpoint_digest: endpoint_digest.to_owned(),
    };
    let mut last_ambiguous = None;
    for attempt in 1..=DIRECT_MUTATION_ATTEMPTS {
        match tono_service_protocol::renew_direct_runtime_reload(&credentials, session, request.clone()).await {
            Ok(response) => {
                if response.code > 0 {
                    bail!(response.message);
                }
                if let Some(result) = response.data {
                    return Ok(result);
                }
                last_ambiguous = Some("Tono Service omitted the DIRECT renewal proof".to_owned());
            }
            Err(error) => {
                last_ambiguous = Some(format!("无法连接到Tono Service: {error:#}"));
            }
        }
        if attempt < DIRECT_MUTATION_ATTEMPTS {
            tokio::time::sleep(DIRECT_MUTATION_RETRY_DELAY).await;
        }
    }
    bail!(
        "DIRECT renewal remained ambiguous after replay: {}",
        last_ambiguous.unwrap_or_else(|| "no response".to_owned())
    )
}

/// `POST /kill-switch/lock`: permit the tunnel interface and retract the API bootstrap channel.
/// Idempotent on the Service side; doubles as the TUN adapter existence check.
pub(crate) async fn tono_lock_kill_switch_for_session(session: &OwnerSessionProof) -> Result<()> {
    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::lock_kill_switch(
        &credentials,
        session,
        KillSwitchLockRequest { tunnel_interface: None },
    )
    .await
    .context("无法连接到Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    Ok(())
}

pub(crate) async fn tono_mark_kill_switch_verified_for_session(session: &OwnerSessionProof) -> Result<()> {
    let credentials = current_owner_credentials()?;
    let mut last_transport_error = None;
    for attempt in 1..=MARK_VERIFIED_ATTEMPTS {
        match tono_service_protocol::mark_kill_switch_verified(&credentials, session).await {
            Ok(response) => {
                if response.code > 0 {
                    bail!(response.message);
                }
                return Ok(());
            }
            Err(error) => {
                last_transport_error = Some(error);

                // The response may be the only thing that was lost. A fully locked, live,
                // verified read-back proves the idempotent mutation committed and is stronger
                // evidence than replaying it blindly.
                if let Ok(status_response) = tono_service_protocol::get_kill_switch_status(&credentials).await
                    && status_response.code == 0
                    && status_response.data.as_ref().is_some_and(mark_verified_committed)
                {
                    logging!(
                        warn,
                        Type::Service,
                        "Tono: MarkVerified response was lost, but Service status proves it committed"
                    );
                    return Ok(());
                }
            }
        }

        if attempt < MARK_VERIFIED_ATTEMPTS {
            tokio::time::sleep(MARK_VERIFIED_RETRY_DELAY).await;
        }
    }

    match last_transport_error {
        Some(error) => Err(error).context("无法连接到Tono Service"),
        None => bail!("MarkVerified retry loop completed without a response"),
    }
}

fn mark_verified_committed(status: &KillSwitchStatus) -> bool {
    status.wanted
        && status.verified
        && status.live
        && status.mode == KillSwitchStatusMode::Locked
        && status.tunnel_permit_rendered
}

/// `POST /kill-switch/restrict-bootstrap`: keep blocking, reopen only the API recovery channel.
pub(crate) async fn tono_restrict_bootstrap() -> Result<()> {
    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::restrict_kill_switch_bootstrap(&credentials)
        .await
        .context("无法连接到Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    Ok(())
}

/// `POST /dns/enable`: snapshot adapter DNS and point resolvers at loopback.
pub(crate) async fn tono_enable_protected_dns_for_session(session: &OwnerSessionProof) -> Result<DnsProtectionStatus> {
    let credentials = current_owner_credentials()?;
    let response = match tono_service_protocol::enable_protected_dns(&credentials, session).await {
        Ok(response) => response,
        Err(error) => {
            // A write can commit even when its response is lost. This operation is idempotent,
            // but the IPC layer deliberately does not retry writes; instead prove the complete
            // postcondition with a read before reporting failure to the connection transaction.
            if let Ok(status_response) = tono_service_protocol::get_protected_dns_status(&credentials).await
                && status_response.code == 0
                && let Some(status) = status_response.data
                && status.enabled
                && status.snapshot_present
                && status.adapters > 0
                && status.last_error.is_none()
            {
                logging!(
                    warn,
                    Type::Service,
                    "Tono: DNS enable response was lost, but the Service status proves protection completed"
                );
                return Ok(status);
            }
            return Err(error).context("无法连接到Tono Service");
        }
    };
    if response.code > 0 {
        bail!(response.message);
    }
    response.data.context("Tono Service 未返回 DNS 保护状态")
}

/// `GET /dns/status`: independent proof used by the Connected health monitor. In particular,
/// this detects a newly added adapter even if its first netmon event happened while the monitor
/// was seeding its event counter.
pub(crate) async fn tono_protected_dns_status() -> Result<DnsProtectionStatus> {
    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::get_protected_dns_status(&credentials)
        .await
        .context("无法连接到Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    response.data.context("Tono Service 未返回 DNS 保护状态")
}

/// `POST /dns/restore`: restore the snapshotted adapter DNS. Always runs before the kill
/// switch is disarmed; a failure here keeps the system armed (product contract §6).
pub(crate) async fn tono_restore_protected_dns() -> Result<DnsProtectionStatus> {
    let credentials = current_owner_credentials()?;
    let response = match tono_service_protocol::restore_protected_dns(&credentials).await {
        Ok(response) => response,
        Err(error) => {
            // A transport error may mean only the response was lost. Prove the idempotent
            // postcondition before telling Disconnect that protection must remain armed.
            if let Ok(status_response) = tono_service_protocol::get_protected_dns_status(&credentials).await
                && status_response.code == 0
                && let Some(status) = status_response.data
                && !status.snapshot_present
                && !status.enabled
            {
                logging!(
                    warn,
                    Type::Service,
                    "Tono: DNS restore response was lost, but the Service status proves restore completed"
                );
                return Ok(status);
            }
            return Err(error).context("无法连接到Tono Service");
        }
    };
    if response.code > 0 {
        bail!(response.message);
    }
    response.data.context("Tono Service 未返回 DNS 保护状态")
}

/// `GET /status`: the full Service snapshot (kill switch aggregate + network event feed).
pub(crate) async fn tono_service_status_snapshot() -> Result<ServiceStatusSnapshot> {
    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::get_status(&credentials)
        .await
        .context("无法连接到Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    response.data.context("Tono Service 未返回状态快照")
}

/// `POST /kill-switch/release` (owner-gated, protocol rev 6): the explicit
/// user disarm. Works without a session — by the time Protected Offline is
/// released, the session that armed the switch is long gone. Idempotent on
/// the Service side and itself enforces DNS-before-disarm.
pub(crate) async fn tono_release_kill_switch() -> Result<KillSwitchStatus> {
    let credentials = current_owner_credentials()?;
    let response = match tono_service_protocol::release_kill_switch(&credentials).await {
        Ok(response) => response,
        Err(error) => {
            // Release is idempotent. If only its response was lost, a read-back prevents the UI
            // from falsely claiming protection remains on after WFP was already disarmed.
            if let Ok(status_response) = tono_service_protocol::get_kill_switch_status(&credentials).await
                && status_response.code == 0
                && let Some(status) = status_response.data
                && !status.wanted
                && !status.live
            {
                logging!(
                    warn,
                    Type::Service,
                    "Tono: kill-switch release response was lost, but status proves disarm completed"
                );
                cancel_owner_monitors();
                clear_active_service_session();
                CoreManager::global().core_stopped();
                return Ok(status);
            }
            return Err(error).context("无法连接到Tono Service");
        }
    };
    if response.code > 0 {
        bail!(response.message);
    }
    let status = response.data.context("Tono Service 未返回 Kill Switch 状态")?;
    if !status.wanted && !status.live {
        // The owner-gated Service release is a complete last-resort disconnect and may have
        // stopped a Core after our session-gated best-effort stop failed. Mirror that committed
        // reality locally so Quit and the next Connect never reuse a stale session/running mode.
        cancel_owner_monitors();
        clear_active_service_session();
        CoreManager::global().core_stopped();
    }
    Ok(status)
}

/// Whether a live owner session exists for session-gated routes (stop-core
/// among them). False in Protected Offline after an app restart — which is
/// exactly why the release path is owner-gated instead (C1).
#[cfg(not(windows))]
pub(crate) fn tono_session_live() -> bool {
    ACTIVE_SERVICE_SESSION.lock().is_some()
}

pub(crate) async fn update_writer_by_service(writer: &WriterConfig) -> Result<()> {
    let credentials = current_owner_credentials()?;
    let session = active_service_session()?;
    let response = tono_service_protocol::update_writer(&credentials, &session, writer)
        .await
        .context("无法连接到Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    Ok(())
}

pub(super) async fn set_system_proxy_by_service(proxy: &MacosProxyConfig) -> Result<ProxyApplyOutcome> {
    let session = active_service_session()?;
    set_system_proxy_by_service_with_session(proxy, &session).await
}

pub(super) async fn set_system_proxy_by_service_with_session(
    proxy: &MacosProxyConfig,
    session: &OwnerSessionProof,
) -> Result<ProxyApplyOutcome> {
    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::set_system_proxy(&credentials, session, proxy)
        .await
        .context("无法连接到Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    response.data.context("Tono Service 未返回系统代理结果")
}
impl ServiceManager {
    pub const fn config() -> tono_service_protocol::IpcConfig {
        tono_service_protocol::IpcConfig {
            default_timeout: Duration::from_millis(150),
            retry_delay: Duration::from_millis(250),
            max_retries: 20,
        }
    }

    pub async fn confirm_ready(&self) -> Result<()> {
        RUN_STATE.probe().await.map(|_| ())
    }

    pub async fn current(&self) -> ServiceStatus {
        ServiceStatus::from_run_state(&RUN_STATE.settled().await)
    }

    #[allow(dead_code)]
    pub fn allow_sidecar_for_session(&self) -> Result<()> {
        RUN_STATE.allow_sidecar_for_session()
    }

    pub fn require_install_for_session(&self) -> Result<()> {
        RUN_STATE.require_install_for_session()
    }

    #[allow(dead_code)]
    pub(crate) fn withdraw_sidecar_allowance(&self) -> bool {
        RUN_STATE.withdraw_sidecar_allowance()
    }

    pub async fn detect_startup_status(&self) {
        if cfg!(feature = "dev-sidecar") {
            RUN_STATE.accept_sidecar();
            return;
        }
        RUN_STATE.observe_current_health().await;
    }

    fn set_status(&self, status: ServiceStatus) {
        record_status(&RUN_STATE, status);
    }

    async fn run_operation(&self, operation: impl Future<Output = Result<()>>) -> Result<()> {
        run_operation_and_then(&RUN_STATE, operation, || async {
            if let Err(error) = Tray::global().update_menu().await {
                logging!(
                    warn,
                    Type::Service,
                    "failed to refresh tray after service operation: {error:#}"
                );
            }
            Ok(())
        })
        .await
    }

    pub async fn refresh(&self) -> Result<()> {
        self.run_operation(async { self.confirm_ready().await }).await
    }

    pub async fn handle_service_status(&self, status: ServiceStatus) -> Result<()> {
        // Box the large operation future once instead of carrying it in every calling command.
        self.run_operation(Box::pin(self.apply_service_status(status))).await
    }

    async fn apply_service_status(&self, status: ServiceStatus) -> Result<()> {
        // Derived from the caller's own argument, not read back out of the store: an
        // observation racing in between would clear the pending action and silently turn a
        // user-authorised install into a no-op.
        let Some(action) = requested_action(&status) else {
            self.set_status(status.clone());
            return report_non_actionable_status(status);
        };
        // Atomically record the request and capture the Sidecar allowance it clears.
        let sidecar_allowed_before = RUN_STATE.request_action(action);

        logging!(info, Type::Service, "running privileged service action {action:?}");
        run_action_restoring_sidecar(&RUN_STATE, sidecar_allowed_before, async move {
            RUN_STATE.perform(action).await?;
            if !matches!(action, PendingAction::Uninstall) {
                wait_for_service_ipc().await?;
                Config::restore_tun_for_session().await;
            }
            Ok(())
        })
        .await
    }
}

/// Run the full action workflow and restore the session's previous Sidecar allowance on failure.
///
/// This includes the readiness wait: an action has not landed until the Service responds.
async fn run_action_restoring_sidecar<E: RunStateEnv>(
    store: &RunStateStore<E>,
    was_allowed: bool,
    action: impl Future<Output = Result<()>>,
) -> Result<()> {
    let outcome = action.await;
    if outcome.is_err() && was_allowed && store.restore_sidecar_allowance() {
        logging!(
            info,
            Type::Service,
            "restored the Sidecar this session had already settled on"
        );
    }
    outcome
}

/// Explain a status that asks for no privileged action, refusing the ones we cannot act on.
fn report_non_actionable_status(status: ServiceStatus) -> Result<()> {
    match status {
        ServiceStatus::Checking => bail!("service status is still being checked"),
        ServiceStatus::Ready => logging!(info, Type::Service, "服务就绪，直接启动"),
        ServiceStatus::NotInstalled => {
            logging!(info, Type::Service, "service is not installed; Sidecar is available");
        }
        ServiceStatus::NeedsReinstall => {
            bail!("service needs reinstall; explicit authorization is required");
        }
        ServiceStatus::Unavailable(reason) => {
            logging!(info, Type::Service, "服务不可用: {}，将使用Sidecar模式", reason);
            bail!("服务不可用: {}", reason);
        }
        ServiceStatus::SidecarAllowed => {
            logging!(
                info,
                Type::Service,
                "Sidecar was explicitly allowed for this app session"
            );
        }
        ServiceStatus::InstallRequired
        | ServiceStatus::UninstallRequired
        | ServiceStatus::ReinstallRequired
        | ServiceStatus::ForceReinstallRequired => {
            bail!("a requested action should have been handled as a privileged operation")
        }
    }
    Ok(())
}

/// Run a privileged operation while holding the Run State operation slot.
///
/// The slot is released — and `settled` waiters woken — before `post_operation` runs, so a
/// post-operation refresh such as the tray menu observes the final state rather than a
/// state still flagged as in-flight.
async fn run_operation_and_then<E, Post, PostFuture>(
    store: &RunStateStore<E>,
    operation: impl Future<Output = Result<()>>,
    post_operation: Post,
) -> Result<()>
where
    E: RunStateEnv,
    Post: FnOnce() -> PostFuture,
    PostFuture: Future<Output = Result<()>>,
{
    let result = {
        let _operation = store.begin_operation()?;
        operation.await
    };
    result?;
    post_operation().await
}

/// Apply a legacy single-slot status to a Run State, splitting it back into observation and
/// request. The inverse of [`ServiceStatus::from_run_state`].
/// The privileged operation a status is asking for, if any.
///
/// A pure function of the status so that a caller can decide what to run without reading the
/// store back and racing an observation.
const fn requested_action(status: &ServiceStatus) -> Option<PendingAction> {
    match status {
        ServiceStatus::InstallRequired => Some(PendingAction::Install),
        ServiceStatus::UninstallRequired => Some(PendingAction::Uninstall),
        ServiceStatus::ReinstallRequired => Some(PendingAction::Reinstall),
        ServiceStatus::ForceReinstallRequired => Some(PendingAction::ForceReinstall),
        ServiceStatus::Checking
        | ServiceStatus::Ready
        | ServiceStatus::NotInstalled
        | ServiceStatus::NeedsReinstall
        | ServiceStatus::SidecarAllowed
        | ServiceStatus::Unavailable(_) => None,
    }
}

fn record_status<E: RunStateEnv>(store: &RunStateStore<E>, status: ServiceStatus) {
    if let Some(action) = requested_action(&status) {
        store.request_action(action);
        return;
    }

    match status {
        ServiceStatus::SidecarAllowed => store.accept_sidecar(),
        ServiceStatus::Checking => store.observe(ServiceHealth::Unknown),
        ServiceStatus::Ready => store.observe(ServiceHealth::Ready),
        ServiceStatus::NotInstalled => store.observe(ServiceHealth::NotInstalled),
        ServiceStatus::NeedsReinstall => store.observe(ServiceHealth::VersionMismatch),
        ServiceStatus::Unavailable(reason) => store.observe(ServiceHealth::Unavailable(reason)),
        ServiceStatus::InstallRequired
        | ServiceStatus::UninstallRequired
        | ServiceStatus::ReinstallRequired
        | ServiceStatus::ForceReinstallRequired => {
            // Recorded by the early return above; listed so a new variant still fails to
            // compile here rather than falling through a catch-all.
        }
    }
}

pub static SERVICE_MANAGER: ServiceManager = ServiceManager;

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, reason = "tests assert by panicking")]
mod tests;
