use crate::core::auth::{
    AuthenticatedOwner, ServiceError, authenticate_owner_off_runtime, hash_session_token,
    ipc_request_context_to_auth_context,
};
use crate::core::desired::{
    ActiveOwnerState, clear_active_owner, commit_active_owner_session, load_active_owner,
    load_owner_desired_state, persist_owner_core_started, persist_owner_core_stopped,
    persist_owner_core_stopped_by_key, persist_owner_writer_config,
};
use crate::core::legacy_cleanup::cleanup_legacy_owner_files;
use crate::core::logger::set_or_update_writer;
use crate::core::macos_kill_switch;
use crate::core::manager::{CORE_MANAGER, LOGGER_MANAGER};
use crate::core::operation::OperationGuard;
use crate::core::paths::service_paths;
use crate::core::runtime_generation::{PreparedRuntime, prepare_runtime, stage_runtime};
use crate::core::state::{set_core_lifecycle_state, set_service_lifecycle_state};
use crate::core::status::service_status_snapshot;
use crate::core::structure::{
    OwnerSessionProof, Response, ServiceLifecycleState, is_protected_startup_replacement_candidate,
};
use crate::core::windows_kill_switch;
use crate::core::{apply_proxy, apply_proxy_or_direct, clear_proxy, dns, validate_proxy_config};
use crate::{
    AuthenticatedRequest, AuthenticatedSessionRequest, BootstrapPins,
    FinalizeDirectRuntimeReloadRequest, IpcCommand, KillSwitchLockRequest,
    MIN_SUPPORTED_CLIENT_REVISION, MacosProxyConfig,
    OwnerSessionHandle, PrepareCoreStartPayload, ProtocolInfo, ProtocolVersion,
    ProxyApplyOutcome, RenewDirectRuntimeReloadRequest, ReplaceDirectEndpointsRequest,
    ReplaceProxyEndpointsRequest,
    RuntimeBundle,
    LEGACY_SERVICE_PROTOCOL_HEADER, SERVICE_PROTOCOL_HEADER, ServiceOperationKind,
    StartClashRequest, StartClashResult,
    StopClashPayload, WriterConfig,
};
use anyhow::{Context as _, Result as AnyResult, anyhow};
use http::StatusCode;
use kode_bridge::{IpcHttpServer, Result, Router, ServerConfig, ipc_http_server::HttpResponse};
use once_cell::sync::Lazy;
use serde::{Serialize, de::DeserializeOwned};
#[cfg(feature = "test")]
use std::sync::atomic::{AtomicU8, Ordering};
use std::{
    future::Future,
    ops::ControlFlow,
    time::{Duration, Instant},
};
#[cfg(feature = "test")]
use tokio::sync::Notify;
use tokio::sync::{Mutex, MutexGuard, mpsc, oneshot};
use tokio::task::JoinHandle;
use tracing::{info, trace, warn};

const IPC_MAX_RESTARTS: u32 = 10;
const IPC_RESTART_WINDOW: Duration = Duration::from_secs(10);
const IPC_MAX_BACKOFF: Duration = Duration::from_millis(500);
/// How long shutdown waits for the listener task to acknowledge that it is done.
const IPC_SHUTDOWN_DONE_TIMEOUT: Duration = Duration::from_secs(5);
/// SCM Stop must finish even if a lifecycle lock or a DNS/WFP worker never returns.
#[cfg(windows)]
const IPC_SERVICE_STOP_TIMEOUT: Duration = Duration::from_secs(60);
/// The budget one privileged step *advertises*, and nothing more.
///
/// This value is only ever handed to [`OperationGuard::begin`], which records it as a deadline in
/// the status snapshot ([`crate::core::operation`]). No timer reads it and nothing cancels a
/// handler when it passes: a step that overruns is visible in `/status`, not stopped. Deliberate —
/// a handler killed mid-transaction is worse than a slow one, and these operations are idempotent
/// and inspectable — but do not read this constant, or the comments elsewhere that lean on it, as
/// a bound. The real bounds are the per-call timeouts inside the subsystems (DNS/WFP engine calls,
/// the authentication probe, the atomic replace, the cleanup walk).
///
/// It is generous because the work behind one step is: DNS enable/restore walk every adapter and
/// fire a (possibly cold-start) PowerShell CIM call per adapter, with one retry each.
const IPC_HANDLER_TIMEOUT: Duration = Duration::from_secs(60);
/// Bounds for the rotation numbers in a client-supplied [`WriterConfig`].
///
/// `directory` is replaced with the owner's own log directory before use, but the rotation
/// numbers used to reach flexi_logger — and the persisted desired state — exactly as sent:
/// `max_log_size: 1` with a large `max_log_files` turns one authorized call into unbounded
/// SYSTEM-side file creation on the system volume.
const MIN_LOG_SIZE_BYTES: u64 = 64 * 1024;
const MAX_LOG_SIZE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_LOG_FILES: usize = 32;
/// Transport-level write timeout. `kode-bridge` enforces it by dropping the handler future and
/// answering a plain 408 — which would release the owner-lifecycle lock and the
/// [`OperationGuard`] while detached `spawn_blocking` work (WFP transactions, PowerShell DNS
/// mutation) keeps running, letting a later privileged mutation interleave with it. Kept far
/// above the worst bounded handler path so the transport never cancels a mutating handler;
/// the per-step [`IPC_HANDLER_TIMEOUT`] budgets stay the real bound. The client's
/// `LIFECYCLE_TIMEOUT` (65s) may now expire while a handler still runs — that is the
/// already-supported lost-response case repaired late via session generations, and strictly
/// safer than dropping a handler mid-transaction.
const IPC_TRANSPORT_WRITE_TIMEOUT: Duration = Duration::from_secs(300);
/// Control-pipe DACL: full control for LocalSystem and Administrators, read/write for
/// **interactive** logons only.
///
/// `IU` rather than `AU` (Authenticated Users) is deliberate. On a domain-joined machine
/// Authenticated Users includes *network* logons, so any authenticated principal on the network
/// could reach `\\host\pipe\tono-service` and speak to a LocalSystem service whose token check
/// is filesystem-based and cannot tell a network logon from a local one. Nothing legitimate
/// needs that: the only client is the desktop app, which by definition runs in the interactive
/// session. Deny-NETWORK is added as well so a principal that is somehow both cannot slip past
/// the allow ACE — deny entries are evaluated first.
#[cfg(any(test, all(windows, not(feature = "test"))))]
const WINDOWS_CONTROL_PIPE_SDDL: &str =
    "D:P(D;;GA;;;NU)(A;;GA;;;SY)(A;;GA;;;BA)(A;;0x0012019b;;;IU)";
#[cfg(all(windows, feature = "test"))]
const WINDOWS_TEST_CONTROL_PIPE_SDDL: &str = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;AU)";

trait OwnerProxyTransition {
    async fn clear_previous_proxy(&mut self) -> AnyResult<()>;
    async fn compensate_direct(&mut self) -> AnyResult<()>;
    async fn stop_previous_core(&mut self) -> AnyResult<()>;
    async fn start_new_core(&mut self) -> AnyResult<()>;
    async fn commit_new_owner(&mut self) -> AnyResult<ActiveOwnerState>;
    async fn apply_new_proxy(&mut self) -> AnyResult<crate::ProxyApplyOutcome>;
}

async fn owner_proxy_transition(
    transition: &mut impl OwnerProxyTransition,
) -> std::result::Result<(ActiveOwnerState, crate::ProxyApplyOutcome), ServiceError> {
    if let Err(clear_error) = transition.clear_previous_proxy().await {
        let compensation = transition.compensate_direct().await;
        let message = match compensation {
            Ok(()) => format!("Failed to clear the previous owner's proxy: {clear_error:#}"),
            Err(compensation_error) => format!(
                "Failed to clear the previous owner's proxy: {clear_error:#}; direct compensation failed: {compensation_error:#}"
            ),
        };
        return Err(ServiceError::proxy_clear_failed(message));
    }

    if let Err(stop_error) = transition.stop_previous_core().await {
        return Err(ServiceError::owner_switch_failed(format!(
            "Failed to stop the previous owner core: {stop_error:#}"
        )));
    }
    transition.start_new_core().await.map_err(|error| {
        ServiceError::owner_switch_failed(format!("Failed to start owner core: {error:#}"))
    })?;
    let active = transition.commit_new_owner().await.map_err(|error| {
        ServiceError::owner_switch_failed(format!("Failed to commit owner state: {error:#}"))
    })?;
    let proxy_outcome = transition.apply_new_proxy().await.map_err(|error| {
        ServiceError::proxy_apply_failed(format!("Failed to apply owner proxy: {error:#}"))
    })?;
    Ok((active, proxy_outcome))
}

struct StartOwnerTransition<'a> {
    previous_owner: Option<ActiveOwnerState>,
    owner: &'a AuthenticatedOwner,
    prepared_runtime: Option<PreparedRuntime>,
    proposed_session_token: &'a str,
    macos_proxy: Option<&'a MacosProxyConfig>,
}

impl OwnerProxyTransition for StartOwnerTransition<'_> {
    async fn clear_previous_proxy(&mut self) -> AnyResult<()> {
        clear_service_proxy().await
    }

    async fn compensate_direct(&mut self) -> AnyResult<()> {
        compensate_service_proxy().await
    }

    async fn stop_previous_core(&mut self) -> AnyResult<()> {
        CORE_MANAGER.lock().await.stop_core().await?;
        if let Some(previous_owner) = self.previous_owner.as_ref() {
            persist_owner_core_stopped_by_key(&previous_owner.owner_key)
                .await
                .context("failed to persist the previous owner stopped state")?;
        }
        clear_active_owner()
            .await
            .context("failed to clear the previous active owner")?;
        Ok(())
    }

    async fn start_new_core(&mut self) -> AnyResult<()> {
        let prepared = self
            .prepared_runtime
            .as_ref()
            .context("prepared runtime is unavailable")?;
        let clash_config = prepared.clash_config().clone();
        // Only now, with the previous core stopped, is the generation safe to rewrite: it is the
        // same directory that core was running in. Planning happened before anything was stopped,
        // so a bundle the service refuses still costs no outage.
        prepared
            .materialize()
            .await
            .context("failed to materialize the runtime generation")?;
        let core_manager = CORE_MANAGER.lock().await;
        let start_result = core_manager
            .start_core(clash_config, self.owner.identity.clone())
            .await;
        drop(core_manager);
        if let Err(error) = start_result {
            if let Err(stop_error) = CORE_MANAGER.lock().await.stop_core().await {
                return Err(anyhow!(
                    "{error:#}; failed to confirm termination of the rejected core: {stop_error:#}"
                ));
            }
            let _ = persist_owner_core_stopped(self.owner).await;
            // The generation stays. It is the owner's one runtime directory, holding the core's
            // own state, and what it describes now is a configuration this service accepted — the
            // same one a retry would write again.
            return Err(error);
        }
        Ok(())
    }

    async fn commit_new_owner(&mut self) -> AnyResult<ActiveOwnerState> {
        let clash_config = self
            .prepared_runtime
            .as_ref()
            .context("prepared runtime is unavailable during owner commit")?
            .clash_config();
        if let Err(error) = persist_owner_core_started(self.owner, clash_config).await {
            return self.rollback_commit_failure(error).await;
        }
        match commit_active_owner_session(self.owner, self.proposed_session_token).await {
            Ok(active) => {
                self.prepared_runtime
                    .take()
                    .context("prepared runtime disappeared during owner commit")?
                    .commit();
                Ok(active)
            }
            Err(error) => self.rollback_commit_failure(error).await,
        }
    }

    async fn apply_new_proxy(&mut self) -> AnyResult<ProxyApplyOutcome> {
        apply_service_proxy_or_direct(self.macos_proxy).await
    }
}

impl StartOwnerTransition<'_> {
    async fn rollback_commit_failure<T>(&mut self, error: anyhow::Error) -> AnyResult<T> {
        if let Err(rollback_error) = rollback_started_owner(self.owner).await {
            return Err(anyhow!(
                "{error:#}; failed to roll back uncommitted owner core: {rollback_error:#}"
            ));
        }
        // The prepared runtime is dropped rather than discarded: the generation is the owner's
        // durable directory, so rolling back the *owner* leaves nothing on disk to undo.
        self.prepared_runtime.take();
        Err(error)
    }
}

/// Whether this build drives the machine's proxy settings.
///
/// Only macOS has a backend behind `proxy`, and a `test` build must not reach the developer's
/// real settings — so everywhere else the verbs below stay callable and do nothing, rather than
/// each caller having to know which platform it is on.
const SERVICE_PROXY_IS_LIVE: bool = cfg!(all(target_os = "macos", not(feature = "test")));

async fn clear_service_proxy() -> AnyResult<()> {
    if SERVICE_PROXY_IS_LIVE {
        clear_proxy().await
    } else {
        Ok(())
    }
}

async fn compensate_service_proxy() -> AnyResult<()> {
    if SERVICE_PROXY_IS_LIVE {
        apply_proxy(&MacosProxyConfig::Disabled).await
    } else {
        Ok(())
    }
}

#[cfg(not(feature = "test"))]
async fn apply_service_proxy_or_direct(
    config: Option<&MacosProxyConfig>,
) -> AnyResult<ProxyApplyOutcome> {
    apply_proxy_or_direct(config).await
}

#[cfg(feature = "test")]
async fn apply_service_proxy_or_direct(
    config: Option<&MacosProxyConfig>,
) -> AnyResult<ProxyApplyOutcome> {
    let _ = apply_proxy_or_direct;
    test_proxy_barrier_block_if_armed().await;
    Ok(if config.is_some() {
        ProxyApplyOutcome::Applied
    } else {
        ProxyApplyOutcome::NotRequested
    })
}

async fn clear_proxy_with_direct_compensation() -> std::result::Result<(), ServiceError> {
    let Err(clear_error) = clear_service_proxy().await else {
        return Ok(());
    };
    let compensation = compensate_service_proxy().await;
    let message = match compensation {
        Ok(()) => format!("Failed to clear the active owner's proxy: {clear_error:#}"),
        Err(compensation_error) => format!(
            "Failed to clear the active owner's proxy: {clear_error:#}; direct compensation failed: {compensation_error:#}"
        ),
    };
    Err(ServiceError::proxy_clear_failed(message))
}

async fn rollback_started_owner(
    owner: &AuthenticatedOwner,
) -> std::result::Result<(), OwnerRollbackFailure> {
    if let Err(stop_error) = CORE_MANAGER.lock().await.stop_core().await {
        set_core_lifecycle_state(ServiceLifecycleState::Fatal);
        return Err(OwnerRollbackFailure::CoreStopUnconfirmed(anyhow!(
            "failed to terminate owner core during rollback: {stop_error:#}"
        )));
    }

    let desired_result = persist_owner_core_stopped(owner).await;
    let active_result = clear_active_owner().await;
    match (desired_result, active_result) {
        (Ok(_), Ok(())) => Ok(()),
        (Err(desired_error), Ok(())) => Err(OwnerRollbackFailure::Bookkeeping(desired_error)),
        (Ok(_), Err(active_error)) => Err(OwnerRollbackFailure::Bookkeeping(active_error)),
        (Err(desired_error), Err(active_error)) => {
            set_core_lifecycle_state(ServiceLifecycleState::Fatal);
            Err(OwnerRollbackFailure::Bookkeeping(anyhow!(
                "failed to persist stopped owner state: {desired_error:#}; failed to clear active owner: {active_error:#}"
            )))
        }
    }
}

/// The core is already confirmed stopped, and recording that stop failed.
///
/// The on-disk run intent is therefore still the previous one. Leaving protected
/// DNS pointed at `198.18.0.2` with nothing listening blackholes the machine.
/// When the caller asked to release, run the same stop transition a recorded
/// stop runs: restore DNS, then the non-strict WFP release. Otherwise the
/// intent still wants the core, so bring it back and leave the barrier armed.
/// If that restart cannot be proven, restore DNS. A kept session is not
/// full-opened here, and the success path of `StopClash` is unchanged.
///
/// A non-strict session whose restart failed has no Core, no Core watchdog and,
/// once verified, no proof deadline: nothing in the Service would ever open it
/// (#1139, decision 031). Queue the same epoch-fenced retirement an exhausted
/// Core watchdog queues; the WFP watchdog then retires the run intent and opens
/// general traffic with the AI hold. The caller holds owner lifecycle, so the
/// arm read here is the one that was stopped, and a successor Connect revokes
/// the queued retirement by arming. Strict keeps its barrier.
pub(crate) async fn recover_after_unrecorded_stop(
    owner: &AuthenticatedOwner,
    release_kill_switch: bool,
) -> AnyResult<()> {
    if release_kill_switch {
        macos_kill_switch::transition_after_stop(true).await?;
        return windows_kill_switch::transition_after_stop(true).await;
    }
    if let Err(error) = restart_still_wanted_core(owner).await {
        warn!(
            "stop was not recorded and the core could not be brought back; restoring DNS and retiring a non-strict session: {error:#}"
        );
        let dns_restored = dns::ensure_restored().await;
        // Not gated on the DNS verdict: the queued release restores DNS best-effort again,
        // and a dead resolver behind a kept barrier is the worse outcome.
        windows_kill_switch::note_core_recovery_exhausted(windows_kill_switch::core_arm_epoch())
            .await;
        dns_restored.context(
            "protected DNS stayed pointed at the dead resolver after the core could not be restarted",
        )?;
    }
    Ok(())
}

async fn restart_still_wanted_core(owner: &AuthenticatedOwner) -> AnyResult<()> {
    let state = load_owner_desired_state(&owner.key).await?;
    if !state.core_should_be_running {
        anyhow::bail!("desired state does not still ask for the core");
    }
    let config = state
        .last_clash_config
        .context("desired state has no core config to bring back")?;
    CORE_MANAGER
        .lock()
        .await
        .start_core(config, owner.identity.clone())
        .await
}

/// Release already restored public DNS and is about to keep WFP armed. A core stop that did
/// not finish may have left that core alive, so tunnel DNS has to come back. A stop that
/// finished left nothing listening on the tunnel resolver; putting it back would black-hole
/// names, and this function does not open the barrier.
pub(super) fn release_puts_protected_dns_back(failure: &OwnerRollbackFailure) -> bool {
    matches!(failure, OwnerRollbackFailure::CoreStopUnconfirmed(_))
}

pub(super) enum OwnerRollbackFailure {
    CoreStopUnconfirmed(anyhow::Error),
    Bookkeeping(anyhow::Error),
}

impl std::fmt::Display for OwnerRollbackFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let error = match self {
            Self::CoreStopUnconfirmed(error) | Self::Bookkeeping(error) => error,
        };
        if f.alternate() {
            write!(f, "{error:#}")
        } else {
            write!(f, "{error}")
        }
    }
}

#[cfg(any(windows, test))]
async fn retire_unrecorded_owner_core(
    owner: &AuthenticatedOwner,
) -> std::result::Result<(), OwnerRollbackFailure> {
    // Missing/corrupt ownership is not proof that the independently supervised Core is gone.
    // The caller has already proved ownership of the armed policy under the lifecycle lock.
    if let Err(error) = CORE_MANAGER.lock().await.stop_core().await {
        set_core_lifecycle_state(ServiceLifecycleState::Fatal);
        return Err(OwnerRollbackFailure::CoreStopUnconfirmed(
            error.context("failed to stop Core without an active owner record"),
        ));
    }
    // Do not add a disk-write dependency to an already idle release or create a default record.
    // A retained runnable intent is retired here whenever the store allows it.
    let retire = async {
        if load_owner_desired_state(&owner.key)
            .await?
            .core_should_be_running
        {
            persist_owner_core_stopped(owner).await?;
        }
        AnyResult::Ok(())
    };
    retire.await.map_err(OwnerRollbackFailure::Bookkeeping)
}

/// Explicit release after the owner's Core was stopped and retired. A confirmed stop whose
/// owner bookkeeping failed releases anyway (decision 031: a persistent ProgramData ACL or AV
/// write failure must not keep a non-strict machine Blocked on every Restore). Replay stays
/// fenced as in `retire_expired_fresh_arm`: `rollback_started_owner` clears the active owner
/// independently of the run-intent write, the unrecorded path has no readable active owner,
/// and the release writes a wanted:false tombstone or removes the wanted intent, without which
/// `restore_desired_state` starts nothing. An unconfirmed stop is still returned for refusal.
#[cfg(any(windows, test))]
fn release_despite_bookkeeping(
    retired: std::result::Result<(), OwnerRollbackFailure>,
) -> std::result::Result<(), OwnerRollbackFailure> {
    match retired {
        Err(OwnerRollbackFailure::Bookkeeping(error)) => {
            warn!(
                "Owner bookkeeping failed after a confirmed Core stop; releasing anyway: {error:#}"
            );
            Ok(())
        }
        other => other,
    }
}

/// Automatic cleanup after abandoned Connect verification or exhausted Core recovery. The
/// WFP watchdog releases its lock before entering here; serialize with Start/Lock/MarkVerified
/// and recheck the arm epoch so a queued predecessor cannot tear down a newer session.
pub(crate) async fn retire_expired_fresh_arm(epoch: u64) -> AnyResult<()> {
    let _lifecycle = OWNER_LIFECYCLE_LOCK.lock().await;
    #[cfg(any(windows, test))]
    if lifecycle_is_stopping() {
        return Ok(());
    }
    // H-IPC-2 again: only a gate another process holds means an installer owns this cleanup.
    // An I/O error preparing or locking `.repair.lock` proves no installer, and refusing on it
    // retried the same refusal every tick while the machine stayed Blocked.
    #[cfg(windows)]
    let repair = crate::acquire_service_repair_gate();
    #[cfg(windows)]
    if installer_holds_repair_gate(&repair) {
        anyhow::bail!("native installer owns abandoned-Connect cleanup");
    }
    #[cfg(windows)]
    if let Err(error) = &repair {
        warn!(
            "Repair gate unavailable; no installer holds it, so abandoned-Connect cleanup proceeds: {error:#}"
        );
    }
    #[cfg(windows)]
    crate::core::update::release_admission()?;

    let Some(owner_key) = windows_kill_switch::expired_fresh_arm_owner(epoch) else {
        return Ok(());
    };
    // REG-1074: refusing on an unreadable or foreign owner record retried the same refusal every
    // tick and left the machine Blocked. An unreadable record proves nothing, so retire the Core
    // as unrecorded, as the owner-gated release does. A readable record naming another owner
    // keeps that owner's Core and record; the abandoned arm is still this owner's, and releasing
    // it keeps the AI hold (decision 031).
    let stops_core = match load_active_owner().await {
        Ok(active) => active.is_none_or(|owner| owner.owner_key == owner_key),
        Err(error) => {
            warn!("Active Core ownership is unreadable; retiring the abandoned Connect as unrecorded: {error:#}");
            true
        }
    };
    if stops_core {
        CORE_MANAGER.lock().await.stop_core().await
            .context("failed to stop the abandoned Connect Core")?;
    } else {
        warn!("Abandoned Connect does not own the active Core; releasing its arm and leaving that Core running");
    }
    // The Core stop is confirmed (or the Core is another owner's). A run-intent write that
    // keeps failing (ProgramData ACL damage, an AV handle) must not refuse the release every
    // tick. Replay stays fenced without it: `restore_desired_state` starts nothing when the
    // active-owner record is gone (cleared independently of the run-intent write below) or
    // when no wanted barrier is restored (the release writes a wanted:false tombstone and,
    // if that write fails, removes the stale wanted record). Only all three writes failing,
    // or a crash before the release writes anything, can leave a same-boot replay behind.
    if let Err(error) = retire_abandoned_run_intent(&owner_key, stops_core).await {
        warn!(
            "Abandoned Connect run intent could not be retired; releasing after the confirmed Core stop: {error:#}"
        );
    }
    windows_kill_switch::release_expired_fresh_arm(epoch).await
}

async fn retire_abandoned_run_intent(owner_key: &str, clears_active_owner: bool) -> AnyResult<()> {
    let run_intent = async {
        if load_owner_desired_state(owner_key)
            .await?
            .core_should_be_running
        {
            persist_owner_core_stopped_by_key(owner_key).await?;
        }
        AnyResult::Ok(())
    }
    .await;
    // Independent of the run-intent write: an absent active owner alone fences Core replay.
    let active_owner = if clears_active_owner {
        clear_active_owner().await
    } else {
        Ok(())
    };
    match (run_intent, active_owner) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
        (Err(run_intent), Err(active_owner)) => Err(anyhow!(
            "{run_intent:#}; the active owner could not be cleared either: {active_owner:#}"
        )),
    }
}

// 防止旧 listener 的清理删除 supervisor 刚创建的新 socket。
static IPC_LIFECYCLE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
#[cfg(any(windows, test))]
static IPC_STOPPING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(any(windows, test))]
static OWNER_GOODBYE_PENDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(any(windows, test))]
fn lifecycle_is_stopping() -> bool {
    IPC_STOPPING.load(std::sync::atomic::Ordering::SeqCst)
        || OWNER_GOODBYE_PENDING.load(std::sync::atomic::Ordering::SeqCst)
}

/// The listener and the two ends of its shutdown handshake.
///
/// One supervisor owns all three at a time — `IPC_LIFECYCLE_LOCK` is what makes that true — but
/// each is taken and replaced independently as a listener is torn down and rebuilt, so they are
/// three cells rather than one.
static IPC_SERVER: Lazy<Mutex<Option<IpcHttpServer>>> = Lazy::new(|| Mutex::new(None));
static IPC_SHUTDOWN_SENDER: Lazy<Mutex<Option<oneshot::Sender<()>>>> =
    Lazy::new(|| Mutex::new(None));
static IPC_SHUTDOWN_DONE: Lazy<Mutex<Option<oneshot::Receiver<()>>>> =
    Lazy::new(|| Mutex::new(None));

/// How long the owner-goodbye route waits before triggering teardown, so its 200 response
/// reaches the App before the listener it arrived on is shut down.
const OWNER_GOODBYE_RESPONSE_GRACE: Duration = Duration::from_millis(250);

/// The service-process end of the owner-goodbye handshake. The library owns the channel so the
/// service binary and the route share it without a registration step; the receiver is taken
/// exactly once, by the binary's shutdown future.
static OWNER_GOODBYE_CHANNEL: Lazy<(mpsc::Sender<()>, Mutex<Option<mpsc::Receiver<()>>>)> =
    Lazy::new(|| {
        let (sender, receiver) = mpsc::channel(1);
        (sender, Mutex::new(Some(receiver)))
    });

/// Wait for an authenticated owner-goodbye (`POST /lifecycle/owner-goodbye`). Pends forever when
/// the route never fires — the binary `select!`s this against its own shutdown signal — or when
/// the receiver was already taken (a second consumer would be a bug, and must not resolve).
pub async fn owner_goodbye_requested() {
    match OWNER_GOODBYE_CHANNEL.1.lock().await.take() {
        Some(mut receiver) => {
            receiver.recv().await;
        }
        None => std::future::pending::<()>().await,
    }
}

/// Fire the owner-goodbye after the response grace (see the constant for why the delay exists).
/// A full channel means a goodbye is already in flight; either way one trigger is enough.
/// The route holds OWNER_LIFECYCLE_LOCK: reserve process shutdown before admitting another
/// mutation. Unlike IPC_STOPPING, this reservation survives a listener restart in the grace.
fn schedule_owner_goodbye_shutdown() {
    #[cfg(any(windows, test))]
    OWNER_GOODBYE_PENDING.store(true, std::sync::atomic::Ordering::SeqCst);
    let sender = OWNER_GOODBYE_CHANNEL.0.clone();
    tokio::spawn(async move {
        tokio::time::sleep(OWNER_GOODBYE_RESPONSE_GRACE).await;
        let _ = sender.try_send(());
    });
}

/// The owner-goodbye decision, pure so the whole outcome space is testable.
///
/// `desired_running` is `None` when the durable desired state could not be read: an unreadable
/// record must refuse exactly like a running one, or a transient read failure would stop the
/// daemon out from under a core the owner still wants. Every refusal is
/// `ServiceErrorCode::StillProtected` (409 Conflict): the machine still needs the daemon.
fn owner_goodbye_verdict(
    kill_switch_wanted: bool,
    desired_running: Option<bool>,
) -> std::result::Result<(), ServiceError> {
    if kill_switch_wanted {
        return Err(ServiceError::still_protected(
            "kill switch is armed; the service must stay alive to police the barrier",
        ));
    }
    match desired_running {
        Some(false) => Ok(()),
        Some(true) => Err(ServiceError::still_protected(
            "the durable desired state still wants the core running",
        )),
        None => Err(ServiceError::still_protected(
            "the durable desired state could not be read",
        )),
    }
}

/// Tell the listener to stop, then forget it.
///
/// The order matters and is the only reason this is a function: dropping the handle without
/// calling `shutdown` leaves the listener running with nobody holding it.
async fn shutdown_ipc_server() {
    let mut guard = IPC_SERVER.lock().await;
    if let Some(server) = guard.as_mut() {
        server.shutdown();
    }
    *guard = None;
}

pub async fn run_ipc_server() -> Result<JoinHandle<Result<()>>> {
    let _lifecycle_guard = IPC_LIFECYCLE_LOCK.lock().await;
    #[cfg(windows)]
    IPC_STOPPING.store(false, std::sync::atomic::Ordering::SeqCst);

    make_ipc_dir().await?;
    cleanup_stale_ipc_socket().await?;
    init_ipc_state().await?;

    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let (done_tx, done_rx) = oneshot::channel::<()>();

    *IPC_SHUTDOWN_SENDER.lock().await = Some(shutdown_tx);
    *IPC_SHUTDOWN_DONE.lock().await = Some(done_rx);

    if let Some(mut server) = IPC_SERVER.lock().await.take() {
        let handle = tokio::spawn(async move {
            let res = tokio::select! {
                res = server.serve() => res,
                _ = &mut shutdown_rx => Ok(()),
            };

            let _ = done_tx.send(());
            res
        });
        Ok(handle)
    } else {
        Err(kode_bridge::KodeBridgeError::configuration(
            "IPC server not initialized".to_string(),
        ))
    }
}

pub async fn stop_ipc_server() -> Result<()> {
    #[cfg(windows)]
    {
        // Connection handlers outlive the listener. Fence their queued mutations before
        // releasing protection so none can re-arm it between teardown and process exit.
        IPC_STOPPING.store(true, std::sync::atomic::Ordering::SeqCst);
        // Noted first, so it is never later than the timeout below; in-flight releases see it too.
        windows_kill_switch::note_release_deadline(
            std::time::Instant::now() + IPC_SERVICE_STOP_TIMEOUT,
        );
        match tokio::time::timeout(IPC_SERVICE_STOP_TIMEOUT, stop_ipc_server_inner()).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => warn!("Service stop cleanup failed; continuing shutdown: {error:#}"),
            Err(_) => warn!("Service stop cleanup timed out; continuing shutdown"),
        }
        return Ok(());
    }
    #[cfg(not(windows))]
    stop_ipc_server_inner().await
}

/// H-IPC-2: only a gate another process holds means an installer owns the stop. An I/O error
/// opening or locking `.repair.lock` proves no installer, and retaining protection on it left a
/// stopped Service blocking the machine; update/installer evidence still fences the release.
#[cfg(any(windows, test))]
fn installer_holds_repair_gate<T>(gate: &AnyResult<Option<T>>) -> bool {
    matches!(gate, Ok(None))
}

async fn stop_ipc_server_inner() -> Result<()> {
    let _lifecycle_guard = IPC_LIFECYCLE_LOCK.lock().await;

    #[cfg(windows)]
    let _owner_lifecycle_guard = OWNER_LIFECYCLE_LOCK.lock().await;
    #[cfg(windows)]
    let repair = crate::acquire_service_repair_gate();
    #[cfg(windows)]
    if let Err(error) = &repair {
        warn!("Service stop repair gate unavailable; no installer holds it, so stop still releases: {error:#}");
    }
    #[cfg(windows)]
    let lifecycle_owned = match crate::core::update::release_admission() {
        Ok(()) => installer_holds_repair_gate(&repair),
        Err(error) => {
            warn!("Service stop release fenced by update/installer evidence: {error:#}");
            true
        }
    };
    #[cfg(windows)]
    let release = windows_kill_switch::service_stop_release_allowed(lifecycle_owned);
    #[cfg(windows)]
    let dns_restore = if release {
        // SCM Stop has no recovery restart. Use Disconnect's DNS -> Core -> WFP order so a
        // non-strict session cannot leave a persistent block and a dead protected resolver.
        dns::ensure_restored().await
    } else {
        Ok(())
    };

    CORE_MANAGER
        .lock()
        .await
        .stop_core()
        .await
        .map_err(|error| kode_bridge::KodeBridgeError::custom(error.to_string()))?;

    #[cfg(windows)]
    if release {
        // Still stop Core if DNS restore failed, but never disarm without the DNS proof.
        dns_restore
            .map_err(|error| kode_bridge::KodeBridgeError::custom(error.to_string()))?;
        // Try to retire the run intent before opening WFP. A metadata failure after confirmed
        // Core stop must not leave a stopped Service blocking the machine; the release's
        // wanted:false tombstone also fences stale runnable intent on the next Service start.
        finish_service_stop_release(crate::core::desired::retire_legacy_active_owner().await)
            .await
            .map_err(|error| kode_bridge::KodeBridgeError::custom(error.to_string()))?;
    }

    if let Some(sender) = IPC_SHUTDOWN_SENDER.lock().await.take() {
        let _ = sender.send(());
    }

    if let Some(done) = IPC_SHUTDOWN_DONE.lock().await.take() {
        // The listener task fires this once it observes the shutdown signal — but it has to be
        // scheduled to do so, and this runs with `IPC_LIFECYCLE_LOCK` held. If the workers are
        // occupied, waiting here is what keeps `run_service` from ever reaching `Stopped` and
        // SCM from ever seeing the service stop. The process is going away regardless, so give
        // the handshake a bounded chance and then stop waiting for it.
        if tokio::time::timeout(IPC_SHUTDOWN_DONE_TIMEOUT, done)
            .await
            .is_err()
        {
            warn!("IPC listener did not acknowledge shutdown in time; continuing teardown");
        }
    }

    shutdown_ipc_server().await;

    cleanup_ipc_path().await?;
    #[cfg(windows)]
    tokio::time::sleep(std::time::Duration::from_millis(70)).await;

    Ok(())
}

pub async fn run_ipc_supervisor_until_shutdown(
    shutdown: impl Future<Output = ()>,
) -> AnyResult<()> {
    set_service_lifecycle_state(ServiceLifecycleState::Starting);
    info!("Starting IPC server...");

    let mut server_handle = match run_ipc_server().await {
        Ok(handle) => handle,
        Err(error) => {
            set_service_lifecycle_state(ServiceLifecycleState::Fatal);
            return Err(anyhow!("failed to start IPC server: {}", error));
        }
    };
    set_service_lifecycle_state(ServiceLifecycleState::Running);
    info!("IPC server started successfully. Waiting for shutdown signal...");

    let mut restart_timestamps: Vec<Instant> = Vec::new();
    let mut consecutive_attempt = 0u32;
    tokio::pin!(shutdown);

    loop {
        tokio::select! {
            _ = &mut shutdown => {
                info!("Shutdown signal received. Stopping IPC server...");
                break;
            }
            join_result = &mut server_handle => {
                let reason = match join_result {
                    Ok(Ok(())) => "IPC server exited cleanly".to_string(),
                    Ok(Err(error)) => format!("IPC server returned error: {error}"),
                    Err(error) => format!("IPC server task failed: {error}"),
                };
                warn!("{reason}; rebuilding IPC listener in-process");
                set_service_lifecycle_state(ServiceLifecycleState::RecoveringIpc);

                let now = Instant::now();
                restart_timestamps.retain(|t| now.duration_since(*t) < IPC_RESTART_WINDOW);
                if restart_timestamps.is_empty() {
                    consecutive_attempt = 0;
                }
                restart_timestamps.push(now);

                if restart_timestamps.len() as u32 > IPC_MAX_RESTARTS {
                    set_service_lifecycle_state(ServiceLifecycleState::Fatal);
                    return Err(anyhow!(
                        "IPC server restarted {} times in {}s",
                        restart_timestamps.len(),
                        IPC_RESTART_WINDOW.as_secs()
                    ));
                }

                let delay = ipc_backoff_delay(consecutive_attempt);
                consecutive_attempt += 1;
                if !delay.is_zero() {
                    tokio::time::sleep(delay).await;
                }

                server_handle = match run_ipc_server().await {
                    Ok(handle) => handle,
                    Err(error) => {
                        set_service_lifecycle_state(ServiceLifecycleState::Fatal);
                        return Err(anyhow!("failed to rebuild IPC server: {}", error));
                    }
                };
                set_service_lifecycle_state(ServiceLifecycleState::Running);
                info!("IPC listener rebuilt successfully");
            }
        }
    }

    stop_ipc_server().await?;
    server_handle.abort();
    Ok(())
}

/// Called only after the stop owner has proved DNS restoration and Core termination.
#[cfg(any(windows, test))]
async fn finish_service_stop_release(retirement: AnyResult<()>) -> AnyResult<()> {
    if let Err(error) = retirement {
        warn!(
            "Service stop owner state could not be retired; attempting release after confirmed Core stop: {error:#}"
        );
    }
    windows_kill_switch::release_after_service_stop().await
}

fn ipc_backoff_delay(attempt: u32) -> Duration {
    if attempt == 0 {
        return Duration::ZERO;
    }

    Duration::from_millis(100u64 << (attempt - 1).min(3)).min(IPC_MAX_BACKOFF)
}

/// Creates the root-owned machine-wide control runtime directory.
async fn make_ipc_dir() -> Result<()> {
    #[cfg(unix)]
    {
        let paths = service_paths();
        let Some(dir_path) = paths.ipc_path().parent() else {
            return Ok(());
        };

        ensure_control_runtime_dir(dir_path)?;
    }
    #[cfg(windows)]
    {
        // No directory creation needed for Windows named pipes
    }
    Ok(())
}

#[cfg(unix)]
fn ensure_control_runtime_dir(dir: &std::path::Path) -> std::io::Result<()> {
    crate::core::unix_security::ensure_service_directory(dir, 0o755)
        .map_err(|error| std::io::Error::other(error.to_string()))
}

async fn cleanup_ipc_path() -> Result<()> {
    #[cfg(unix)]
    {
        use tokio::fs;

        let paths = service_paths();
        if paths.ipc_path().exists() {
            fs::remove_file(paths.ipc_path()).await?;
        }
    }
    #[cfg(windows)]
    {
        // Named pipes on Windows are automatically cleaned up when the last handle is closed
        // No manual cleanup needed
    }
    Ok(())
}

async fn cleanup_stale_ipc_socket() -> Result<()> {
    #[cfg(unix)]
    {
        let paths = service_paths();
        let socket_path = paths.ipc_path();
        if !socket_path.exists() {
            return Ok(());
        }

        match tokio::time::timeout(
            std::time::Duration::from_millis(500),
            tokio::net::UnixStream::connect(socket_path),
        )
        .await
        {
            Ok(Ok(_stream)) => {
                warn!(
                    "IPC socket {:?} is reachable; leaving it in place",
                    socket_path
                );
            }
            _ => {
                info!("Cleaning up stale IPC socket: {:?}", socket_path);
                tokio::fs::remove_file(socket_path).await?;
            }
        }
    }
    #[cfg(windows)]
    {}
    Ok(())
}

async fn init_ipc_state() -> Result<()> {
    let server = create_ipc_server()?;
    let router = create_ipc_router()?;
    let server = server.router(router);
    *IPC_SERVER.lock().await = Some(server);
    Ok(())
}

fn create_ipc_server() -> Result<IpcHttpServer> {
    let paths = service_paths();

    let server = IpcHttpServer::with_config(
        paths.ipc_path(),
        ServerConfig {
            write_timeout: IPC_TRANSPORT_WRITE_TIMEOUT,
            ..ServerConfig::default()
        },
    )?;

    #[cfg(unix)]
    {
        use platform_lib::{S_IRGRP, S_IROTH, S_IRUSR, S_IWGRP, S_IWOTH, S_IWUSR, mode_t};

        let mode: mode_t =
            platform_lib::mode_t::from(S_IRUSR | S_IWUSR | S_IRGRP | S_IWGRP | S_IROTH | S_IWOTH);
        let server = server.with_listener_mode(mode);
        Ok(server)
    }

    #[cfg(windows)]
    {
        // The production service runs as SYSTEM, whose ACE may create subsequent
        // named-pipe instances. Integration tests run as the invoking user, so
        // they need a test-only server ACE with the same create-instance right.
        // Production clients still receive only read/write access.
        #[cfg(feature = "test")]
        let descriptor = WINDOWS_TEST_CONTROL_PIPE_SDDL;
        #[cfg(not(feature = "test"))]
        let descriptor = WINDOWS_CONTROL_PIPE_SDDL;
        let server = server.with_listener_security_descriptor(descriptor);
        Ok(server)
    }
}

fn require_protocol_version(
    ctx: &kode_bridge::RequestContext,
) -> std::result::Result<(), ServiceError> {
    let supplied = ctx
        .headers
        .get(SERVICE_PROTOCOL_HEADER)
        .or_else(|| ctx.headers.get(LEGACY_SERVICE_PROTOCOL_HEADER))
        .and_then(|value| value.to_str().ok());
    let Some(supplied) = supplied.and_then(ProtocolVersion::parse_header) else {
        return Err(ServiceError::protocol_mismatch());
    };
    let current = ProtocolVersion::current();
    (supplied.epoch == current.epoch && supplied.revision >= MIN_SUPPORTED_CLIENT_REVISION)
        .then_some(())
        .ok_or_else(ServiceError::protocol_mismatch)
}

/// The two request envelopes a protected route can arrive in.
///
/// Both carry credentials in the same place, so a route's parse-and-authenticate step does not
/// need to know which shape it just read.
trait OwnerRequestEnvelope {
    fn credentials(&self) -> &crate::OwnerCredentials;
}

impl<T> OwnerRequestEnvelope for AuthenticatedRequest<T> {
    fn credentials(&self) -> &crate::OwnerCredentials {
        &self.credentials
    }
}

impl<T> OwnerRequestEnvelope for AuthenticatedSessionRequest<T> {
    fn credentials(&self) -> &crate::OwnerCredentials {
        &self.credentials
    }
}

/// Protocol version, then deserialization, then owner authentication.
///
/// The order is load-bearing: a client speaking the wrong revision must be told so before its
/// body is interpreted, and nothing may be authenticated against credentials that have not been
/// parsed. Failures come back already encoded so a handler stays one `match`.
///
/// This deliberately stops short of the lifecycle lock. `StartClash` validates its payload in
/// between, and must keep doing so before it waits on a contended lock.
///
/// The authentication step is the one `await` here: it probes a client-supplied path, so it runs
/// on a blocking worker under its own deadline rather than on one of the four runtime workers
/// every other route also needs. The decision it returns is unchanged.
async fn authenticate_request<E>(
    ctx: &kode_bridge::RequestContext,
) -> ControlFlow<Result<HttpResponse>, (E, AuthenticatedOwner)>
where
    E: DeserializeOwned + OwnerRequestEnvelope,
{
    if let Err(error) = require_protocol_version(ctx) {
        return ControlFlow::Break(service_error(error));
    }
    let request = match ctx.json::<E>() {
        Ok(request) => request,
        Err(error) => return ControlFlow::Break(bad_request(format!("Invalid JSON: {error}"))),
    };
    let owner = match authenticate_owner_off_runtime(ctx, request.credentials()).await {
        Ok(owner) => owner,
        Err(error) => return ControlFlow::Break(service_error(error)),
    };
    ControlFlow::Continue((request, owner))
}

/// What a route requires of the owner once the lifecycle lock is held.
enum OwnerLifecycleGate<'a> {
    /// `Status` reports inactivity as data rather than as an error, and owner-goodbye applies
    /// its own still-protected verdict. Neither can demand an active owner.
    Unchecked,
    /// Proof that this caller owns the machine-wide armed WFP policy. This check belongs inside
    /// the lifecycle lock: checking before waiting for the lock creates a stale-authorization
    /// window in which a queued StartClash can replace the owner.
    ArmedPolicyOwner,
    /// `ReleaseKillSwitch` only: the same owner proof, admitted by the update evidence read
    /// without a lock or a write (BRICK-W5 d) and past a manual installer lease whose holder is
    /// conclusively dead (Service half of BRICK-W2). Every other route keeps `lifecycle_allowed`.
    ArmedPolicyRelease,
    /// `StartClash` and `PrepareCoreStart` make the caller the owner and may stop the running
    /// Core, so they must not run over armed protection that another local user still holds.
    /// Nor may they first arm protection from a Remote Desktop session, which the arm would cut.
    ArmedPolicyTakeover,
    /// Proof of being the active owner, which is all the read-only log routes need.
    ActiveOwner,
    /// Proof of the current session, not merely of the owner: a second instance of the same
    /// user, or one whose core was replaced, must not reach the running core.
    ActiveSession(&'a OwnerSessionProof),
}

/// Owner authentication proves the *user* (pipe PID token SID plus the `%APPDATA%` token file),
/// and any process of that user can read the token. Routes that arm protection or widen what it
/// lets through must also come from the registered installation's `Tono.exe` — the same image
/// binding the update routes use. See [`enter_protecting_owner_lifecycle`] for which routes those
/// are and why release routes never run this proof.
///
/// Only "the peer's image is not the registered `Tono.exe`" is a 401. A proof that could not be
/// completed is `AppIdentityUnproven` (503): retryable. Both refusals happen before anything is
/// armed or widened, so they leave the machine on whatever network it already had.
#[cfg(windows)]
#[cfg_attr(feature = "test", allow(dead_code))]
async fn prove_installed_app_peer(
    owner: &AuthenticatedOwner,
) -> std::result::Result<(), ServiceError> {
    let Some(pid) = owner.peer_pid else {
        return Err(app_identity_unproven(
            "the pipe did not identify the peer process",
        ));
    };
    match tokio::task::spawn_blocking(move || crate::core::update::app_image(pid)).await {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(error)) if error.is::<crate::core::update::NotRegisteredApp>() => {
            Err(ServiceError::new(
                crate::ServiceErrorCode::UnauthorizedOwner,
                format!("caller is not the installed Tono App: {error:#}"),
            ))
        }
        Ok(Err(error)) => Err(app_identity_unproven(&format!("{error:#}"))),
        Err(error) => Err(app_identity_unproven(&format!(
            "image check did not complete: {error}"
        ))),
    }
}

#[cfg(windows)]
#[cfg_attr(feature = "test", allow(dead_code))]
fn app_identity_unproven(detail: &str) -> ServiceError {
    ServiceError::new(
        crate::ServiceErrorCode::AppIdentityUnproven,
        format!(
            "Tono Service could not confirm that this request came from the installed Tono App \
             ({detail}), so nothing was changed. Try again. If this keeps happening, repair \
             Tono. Disconnect still works."
        ),
    )
}

/// The lifecycle `test` feature drives these routes from test processes, which are the owner user
/// but by construction not the installed App, so the proof is injectable there. The default
/// admits; a test that injects a refusal proves the lifecycle entry applies it.
#[cfg(all(windows, feature = "test"))]
type AppPeerProof = fn(&AuthenticatedOwner) -> std::result::Result<(), ServiceError>;

#[cfg(all(windows, feature = "test"))]
fn admit_test_peer(_: &AuthenticatedOwner) -> std::result::Result<(), ServiceError> {
    Ok(())
}

#[cfg(all(windows, feature = "test"))]
static TEST_APP_PEER_PROOF: std::sync::Mutex<AppPeerProof> =
    std::sync::Mutex::new(admit_test_peer as AppPeerProof);

/// Installs `proof` for the lifecycle entry and returns the one it replaced.
#[cfg(all(windows, feature = "test", test))]
fn replace_test_app_peer_proof(proof: AppPeerProof) -> AppPeerProof {
    std::mem::replace(
        &mut *TEST_APP_PEER_PROOF
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
        proof,
    )
}

#[cfg(all(windows, not(feature = "test")))]
async fn require_installed_app_peer(
    owner: &AuthenticatedOwner,
) -> std::result::Result<(), ServiceError> {
    prove_installed_app_peer(owner).await
}

#[cfg(all(windows, feature = "test"))]
async fn require_installed_app_peer(
    owner: &AuthenticatedOwner,
) -> std::result::Result<(), ServiceError> {
    let proof = *TEST_APP_PEER_PROOF
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    proof(owner)
}

/// [`enter_owner_lifecycle`] for routes that arm protection or widen what it lets through:
/// Connect (`PrepareCoreStart`, `StartClash`, `LockKillSwitch`, `MarkKillSwitchVerified`,
/// `EnableProtectedDns`), runtime and endpoint installs (`StageRuntime`, the DIRECT reload
/// `Begin`/`Replace*`/`Commit` steps) and setting a system proxy. The installed-App image proof
/// runs first and its refusal is side-effect free: a first Connect stays on the ordinary network,
/// and a refused step inside an armed session fails like any other stage failure, whose tail
/// releases through the routes below.
///
/// Release, `RestoreProtectedDns`, `StopClash`, `RestrictKillSwitchBootstrap`, `OwnerGoodbye`,
/// clearing the system proxy, committing or renewing a DIRECT set the gated steps already
/// installed (`Finalize`/`Renew`), `UpdateWriter` and the log reads enter through
/// [`enter_owner_lifecycle`] directly and never run the proof: a proof that fails or is
/// unavailable while WFP is armed must not keep the machine off the network (fail-open,
/// decision 031).
async fn enter_protecting_owner_lifecycle(
    owner: &AuthenticatedOwner,
    gate: OwnerLifecycleGate<'_>,
) -> ControlFlow<Result<HttpResponse>, OwnerLifecycleGuard> {
    #[cfg(windows)]
    if let Err(error) = require_installed_app_peer(owner).await {
        return ControlFlow::Break(service_error(error));
    }
    enter_owner_lifecycle(owner, gate).await
}

/// Takes `OWNER_LIFECYCLE_LOCK` and then applies the route's gate, in that order — the gate
/// reads the very state the lock protects.
///
/// The guard is returned rather than dropped here, so it lives for the whole of the caller's
/// operation. On a rejected gate the response is built while the guard is still held, which is
/// where it is built today.
struct OwnerLifecycleGuard {
    _lifecycle: MutexGuard<'static, ()>,
    #[cfg(windows)]
    _repair: crate::ServiceRepairGate,
}

async fn enter_owner_lifecycle(
    owner: &AuthenticatedOwner,
    gate: OwnerLifecycleGate<'_>,
) -> ControlFlow<Result<HttpResponse>, OwnerLifecycleGuard> {
    let lifecycle_guard = OWNER_LIFECYCLE_LOCK.lock().await;
    #[cfg(any(windows, test))]
    if lifecycle_is_stopping() {
        return ControlFlow::Break(service_unavailable("service is stopping"));
    }
    #[cfg(windows)]
    let repair = match crate::acquire_service_repair_gate() {
        Ok(Some(guard)) => guard,
        Ok(None) => {
            return ControlFlow::Break(service_unavailable("native installer owns the lifecycle"));
        }
        // Still refused (fail-closed), but under its real cause: taking the gate prepares
        // `ProgramData\Tono` and its `bin` directory (private ACL) and opens `.repair.lock`, and an
        // I/O or ACL failure there is not an installer holding the lifecycle.
        Err(error) => {
            warn!("service repair gate unavailable: {error:#}");
            return ControlFlow::Break(service_unavailable(format!(
                "service repair gate unavailable: {error:#}"
            )));
        }
    };
    #[cfg(windows)]
    {
        let admitted = if matches!(gate, OwnerLifecycleGate::ArmedPolicyRelease) {
            crate::core::update::release_admission()
        } else {
            crate::core::update::lifecycle_allowed(owner)
        };
        if let Err(error) = admitted {
            return ControlFlow::Break(service_error(ServiceError::still_protected(
                error.to_string(),
            )));
        }
    }
    let gated = match gate {
        OwnerLifecycleGate::Unchecked => Ok(()),
        OwnerLifecycleGate::ArmedPolicyOwner | OwnerLifecycleGate::ArmedPolicyRelease => {
            windows_kill_switch::authorize_write_for(&owner.key)
        }
        OwnerLifecycleGate::ArmedPolicyTakeover => {
            windows_kill_switch::authorize_takeover_for(&owner.key).and_then(|()| {
                windows_kill_switch::authorize_connect_session_for(
                    &owner.key,
                    owner.peer_session_id,
                )
            })
        }
        OwnerLifecycleGate::ActiveOwner => require_active_owner(owner).await,
        OwnerLifecycleGate::ActiveSession(proof) => {
            require_active_session(owner, proof).await.map(|_| ())
        }
    };
    match gated {
        Ok(()) => ControlFlow::Continue(OwnerLifecycleGuard {
            _lifecycle: lifecycle_guard,
            #[cfg(windows)]
            _repair: repair,
        }),
        Err(error) => ControlFlow::Break(service_error(error)),
    }
}



/// `POST /kill-switch/release` on Windows: the full disarm path (DNS-before-disarm invariant
/// included — a release whose DNS restore cannot be proven is refused and stays armed).
/// Idempotent: not armed is a successful no-op returning the current status.
#[cfg(windows)]
async fn release_kill_switch_for_platform(apply_narrow: bool) -> Result<HttpResponse> {
    let released = if apply_narrow {
        windows_kill_switch::release_applying_narrow().await
    } else {
        windows_kill_switch::release().await
    };
    match released {
        Ok(status) => ok_json(status),
        Err(error) => service_unavailable(format!(
            "Kill switch release refused; protection remains: {error:#}"
        )),
    }
}

/// The macOS mapping: the same explicit user-requested disarm, with the macOS helper's own PF
/// release/failure semantics (there is no DNS snapshot on macOS). Reported through the same
/// wire type so the client has one code path.
#[cfg(target_os = "macos")]
async fn release_kill_switch_for_platform(_apply_narrow: bool) -> Result<HttpResponse> {
    match macos_kill_switch::release().await {
        Ok(()) => {
            let (wanted, live, _mode) = macos_kill_switch::status().await;
            ok_json(crate::KillSwitchStatus {
                wanted,
                verified: false,
                live,
                mode: crate::KillSwitchStatusMode::Blocked,
                // No WFP tunnel permit exists on macOS, and this is a *release* besides.
                tunnel_permit_rendered: false,
                endpoints: Vec::new(),
                direct_endpoint_digest: String::new(),
                last_error: None,
                reconnect_after_release: false,
            })
        }
        Err(error) => service_unavailable(format!("Kill switch release failed: {error:#}")),
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
async fn release_kill_switch_for_platform(_apply_narrow: bool) -> Result<HttpResponse> {
    bad_request("kill switch release is unsupported on this platform")
}

async fn read_log_snapshot(path: &std::path::Path) -> std::io::Result<String> {
    use tokio::io::{AsyncReadExt as _, AsyncSeekExt as _};

    // The kode-bridge in-memory response limit is 10 MiB. Hex keeps the JSON payload
    // bounded and avoids content-dependent escaping expansion.
    const MAX_SNAPSHOT_BYTES: u64 = 4 * 1024 * 1024;
    let mut file = tokio::fs::File::open(path).await?;
    let length = file.metadata().await?.len();
    if length > MAX_SNAPSHOT_BYTES {
        file.seek(std::io::SeekFrom::Start(length - MAX_SNAPSHOT_BYTES))
            .await?;
    }
    let mut content = Vec::with_capacity(length.min(MAX_SNAPSHOT_BYTES) as usize);
    file.read_to_end(&mut content).await?;
    if length > MAX_SNAPSHOT_BYTES
        && let Some(first_newline) = content.iter().position(|byte| *byte == b'\n')
    {
        content.drain(..=first_newline);
    }
    let mut encoded = String::with_capacity(content.len() * 2);
    for byte in content {
        use std::fmt::Write as _;
        let _ = write!(encoded, "{byte:02x}");
    }
    Ok(encoded)
}

fn ok_json<T: Serialize>(data: T) -> Result<HttpResponse> {
    json_response(StatusCode::OK, 0, "Success", Some(data))
}

fn ok_empty(message: impl Into<String>) -> Result<HttpResponse> {
    json_response::<()>(StatusCode::OK, 0, message, None)
}

fn service_unavailable(message: impl Into<String>) -> Result<HttpResponse> {
    json_response::<()>(StatusCode::SERVICE_UNAVAILABLE, 1, message, None)
}

/// Why StartClash must not proceed on this OS, given the kill-switch payloads.
///
/// `os` is `std::env::consts::OS`. `windows_required` is true for a live Windows
/// service binary (not the test feature). Linux has no nftables engine yet, so
/// every StartClash is refused rather than connecting without a barrier.
fn start_clash_kill_switch_rejection(
    os: &str,
    macos_kill_switch_enabled: bool,
    has_windows_kill_switch: bool,
    windows_required: bool,
) -> Option<&'static str> {
    if macos_kill_switch_enabled && os != "macos" {
        return Some("macOS kill switch is unsupported on this platform");
    }
    if has_windows_kill_switch && os != "windows" {
        return Some("Windows kill switch is unsupported on this platform");
    }
    if os == "linux" {
        return Some("Linux kill switch is not implemented; refusing to start without a barrier");
    }
    if os == "windows" && windows_required && !has_windows_kill_switch {
        return Some("Windows kill switch configuration is required");
    }
    None
}

fn bad_request(message: impl Into<String>) -> Result<HttpResponse> {
    json_response::<()>(
        StatusCode::BAD_REQUEST,
        StatusCode::BAD_REQUEST.as_u16(),
        message,
        None,
    )
}

fn service_error(error: ServiceError) -> Result<HttpResponse> {
    let status = match error.code {
        crate::ServiceErrorCode::UnauthorizedOwner => StatusCode::UNAUTHORIZED,
        crate::ServiceErrorCode::NotActive => StatusCode::CONFLICT,
        crate::ServiceErrorCode::StillProtected => StatusCode::CONFLICT,
        // The request describes an attempt an explicit release already superseded: the
        // current state wins, exactly like the other 409 rejections.
        crate::ServiceErrorCode::StaleReleaseEpoch => StatusCode::CONFLICT,
        crate::ServiceErrorCode::ProtectionHeldByAnotherUser => StatusCode::CONFLICT,
        crate::ServiceErrorCode::RemoteSessionConnectRefused => StatusCode::CONFLICT,
        crate::ServiceErrorCode::AppIdentityUnproven => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::UNPROCESSABLE_ENTITY,
    };
    json_response::<()>(status, error.code as u16, error.message, None)
}

async fn require_active_owner(
    owner: &crate::core::auth::AuthenticatedOwner,
) -> std::result::Result<(), ServiceError> {
    if load_active_owner()
        .await
        .map_err(|_| ServiceError::not_active())?
        .is_some_and(|active| active.owner_key == owner.key)
    {
        Ok(())
    } else {
        Err(ServiceError::not_active())
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

pub async fn require_active_session(
    owner: &AuthenticatedOwner,
    proof: &OwnerSessionProof,
) -> std::result::Result<ActiveOwnerState, ServiceError> {
    let active = load_active_owner()
        .await
        .map_err(|_| ServiceError::stale_owner_session())?
        .ok_or_else(ServiceError::stale_owner_session)?;
    let supplied_hash =
        hash_session_token(&proof.token).map_err(|_| ServiceError::stale_owner_session())?;
    if active.owner_key != owner.key
        || active.generation != proof.generation
        || !constant_time_eq(
            active.session_token_hash.as_bytes(),
            supplied_hash.as_bytes(),
        )
    {
        return Err(ServiceError::stale_owner_session());
    }
    Ok(active)
}

fn json_response<T: Serialize>(
    status: StatusCode,
    code: u16,
    message: impl Into<String>,
    data: Option<T>,
) -> Result<HttpResponse> {
    let json_value = Response {
        code,
        message: message.into(),
        data,
    };
    Ok(HttpResponse::builder()
        .status(status)
        .json(&json_value)?
        .build())
}

static OWNER_LIFECYCLE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[cfg(feature = "test")]
const TEST_PROXY_ARMED: u8 = 1 << 0;
#[cfg(feature = "test")]
const TEST_PROXY_ENTERED: u8 = 1 << 1;
#[cfg(feature = "test")]
const TEST_START_WAITING: u8 = 1 << 2;
#[cfg(feature = "test")]
const TEST_PROXY_RELEASED: u8 = 1 << 3;
#[cfg(feature = "test")]
static TEST_PROXY_BARRIER_STATE: AtomicU8 = AtomicU8::new(0);
#[cfg(feature = "test")]
static TEST_PROXY_ENTERED_NOTIFY: Lazy<Notify> = Lazy::new(Notify::new);
#[cfg(feature = "test")]
static TEST_START_WAITING_NOTIFY: Lazy<Notify> = Lazy::new(Notify::new);
#[cfg(feature = "test")]
static TEST_PROXY_RELEASE_NOTIFY: Lazy<Notify> = Lazy::new(Notify::new);

#[cfg(feature = "test")]
fn test_proxy_barrier_arm() {
    TEST_PROXY_BARRIER_STATE.store(TEST_PROXY_ARMED, Ordering::Release);
}

#[cfg(feature = "test")]
async fn test_proxy_barrier_block_if_armed() {
    if TEST_PROXY_BARRIER_STATE
        .compare_exchange(
            TEST_PROXY_ARMED,
            TEST_PROXY_ARMED | TEST_PROXY_ENTERED,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_err()
    {
        return;
    }
    TEST_PROXY_ENTERED_NOTIFY.notify_waiters();
    test_proxy_barrier_wait(TEST_PROXY_RELEASED, &TEST_PROXY_RELEASE_NOTIFY).await;
}

#[cfg(feature = "test")]
fn test_proxy_barrier_note_start_waiting() {
    let state = TEST_PROXY_BARRIER_STATE.load(Ordering::Acquire);
    if state & TEST_PROXY_ENTERED == 0 || state & TEST_PROXY_RELEASED != 0 {
        return;
    }
    if OWNER_LIFECYCLE_LOCK.try_lock().is_err() {
        TEST_PROXY_BARRIER_STATE.fetch_or(TEST_START_WAITING, Ordering::AcqRel);
        TEST_START_WAITING_NOTIFY.notify_waiters();
    }
}

#[cfg(feature = "test")]
async fn test_proxy_barrier_wait(required: u8, notify: &Notify) {
    loop {
        let notified = notify.notified();
        if TEST_PROXY_BARRIER_STATE.load(Ordering::Acquire) & required == required {
            return;
        }
        notified.await;
    }
}

#[cfg(feature = "test")]
fn test_proxy_barrier_release() {
    TEST_PROXY_BARRIER_STATE.fetch_or(TEST_PROXY_RELEASED, Ordering::AcqRel);
    TEST_PROXY_RELEASE_NOTIFY.notify_waiters();
}

#[cfg(feature = "test")]
fn test_proxy_barrier_reset() {
    TEST_PROXY_BARRIER_STATE.store(0, Ordering::Release);
}

mod handlers;
use handlers::create_ipc_router;

#[cfg(test)]
mod release_dns_compensation_tests {
    use super::{OwnerRollbackFailure, release_puts_protected_dns_back};

    #[test]
    fn a_failed_core_stop_puts_protected_dns_back_and_bookkeeping_does_not() {
        let stop = OwnerRollbackFailure::CoreStopUnconfirmed(anyhow::anyhow!("stop"));
        let bookkeeping = OwnerRollbackFailure::Bookkeeping(anyhow::anyhow!("book"));
        assert!(release_puts_protected_dns_back(&stop));
        assert!(
            !release_puts_protected_dns_back(&bookkeeping),
            "a stopped core must not be pointed back at the tunnel resolver"
        );
    }
}

#[cfg(test)]
mod owner_lifecycle_tests;
#[cfg(test)]
mod owner_goodbye_tests;
#[cfg(test)]
mod start_clash_kill_switch_gate_tests;

#[cfg(all(test, feature = "test"))]
mod service_stop_release_tests {
    use super::finish_service_stop_release;
    use crate::core::structure::{KillSwitchConfig, ProxyEndpoint, ProxyProtocol};
    use crate::core::{selective_layer, windows_kill_switch};
    use serial_test::serial;

    #[tokio::test]
    #[serial]
    async fn a_stopped_services_owner_retirement_failure_still_releases_with_the_ai_hold()
    -> anyhow::Result<()> {
        windows_kill_switch::release().await?;
        windows_kill_switch::arm_bootstrap(
            &KillSwitchConfig {
                tunnel_interface: "Tono".to_owned(),
                proxy_endpoints: vec![ProxyEndpoint {
                    ip: "8.8.8.8".to_owned(),
                    port: 443,
                    protocol: ProxyProtocol::Tcp,
                }],
                bootstrap_api_hosts: vec!["1.1.1.1".to_owned()],
                direct_endpoints: Vec::new(),
            },
            "/opt/tono/mihomo",
            "scm-stop-owner",
        )
        .await?;
        let result = finish_service_stop_release(Err(anyhow::anyhow!(
            "owner desired-state file is locked against replacement"
        )))
        .await;
        let wanted = windows_kill_switch::status().await.wanted;
        let ai_held = selective_layer::test_hold_active();
        windows_kill_switch::release().await?;
        assert!(
            result.is_ok(),
            "retirement bookkeeping must not refuse a proven stop release: {result:?}"
        );
        assert!(
            !wanted,
            "SCM stop must not leave persistent broad WFP protection wanted"
        );
        assert!(ai_held, "automatic stop must retain the secondary AI hold");
        Ok(())
    }
}
