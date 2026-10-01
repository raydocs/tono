use super::{
    IPC_HANDLER_TIMEOUT, IPC_TRANSPORT_WRITE_TIMEOUT, OwnerProxyTransition,
    WINDOWS_CONTROL_PIPE_SDDL, owner_proxy_transition, require_active_owner,
    require_active_session,
};
use crate::ServiceErrorCode;
use crate::core::auth::AuthenticatedOwner;
use crate::core::desired::{
    ActiveOwnerState, clear_active_owner, commit_active_owner_session, load_active_owner,
    persist_active_owner,
};
use crate::{OwnerIdentity, OwnerSessionProof, ProxyApplyOutcome};
use serial_test::serial;

fn owner(uid: u32) -> AuthenticatedOwner {
    AuthenticatedOwner {
        key: uid.to_string(),
        identity: OwnerIdentity::Unix { uid, gid: 20 },
        app_data_root: std::env::temp_dir(),
        peer_pid: None,
        peer_session_id: None,
    }
}

#[tokio::test]
#[serial]
async fn release_retires_run_intent_when_the_active_owner_record_is_corrupt() -> anyhow::Result<()> {
    use crate::core::desired::{load_owner_desired_state, persist_owner_core_started};
    use crate::core::paths::service_paths;

    let _lifecycle = super::OWNER_LIFECYCLE_LOCK.lock().await;
    let owner = owner(97_003);
    let paths = service_paths();
    let desired_path = paths.for_owner_key(&owner.key).desired_state_path();
    persist_owner_core_started(&owner, &crate::ClashConfig::default()).await?;
    tokio::fs::write(paths.active_owner_path(), b"{interrupted owner record").await?;
    assert!(load_active_owner().await?.is_none());

    super::retire_unrecorded_owner_core(&owner)
        .await
        .map_err(|failure| anyhow::anyhow!("{failure:#}"))?;
    let still_wanted = load_owner_desired_state(&owner.key).await?.core_should_be_running;
    tokio::fs::remove_file(&desired_path).await?;
    assert!(!still_wanted, "a released Core must not retain runnable desired state");

    // An idle release must not manufacture a state file or gain a new disk-write dependency.
    super::retire_unrecorded_owner_core(&owner)
        .await
        .map_err(|failure| anyhow::anyhow!("{failure:#}"))?;
    assert!(!desired_path.exists());
    Ok(())
}

#[tokio::test]
#[serial]
async fn explicit_release_proceeds_when_the_run_intent_cannot_be_retired() -> anyhow::Result<()> {
    use crate::core::paths::service_paths;

    let _lifecycle = super::OWNER_LIFECYCLE_LOCK.lock().await;
    let owner = owner(97_014);
    // A directory where the desired-state file belongs: every read and write of it fails,
    // like a persistent ProgramData ACL or AV-handle failure.
    let desired_path = service_paths()
        .for_owner_key(&owner.key)
        .desired_state_path();
    tokio::fs::create_dir_all(&desired_path).await?;
    clear_active_owner().await?;

    let retired = super::retire_unrecorded_owner_core(&owner).await;
    let bookkeeping = matches!(retired, Err(super::OwnerRollbackFailure::Bookkeeping(_)));
    let released = super::release_despite_bookkeeping(retired);
    tokio::fs::remove_dir_all(&desired_path).await?;

    assert!(
        bookkeeping,
        "a confirmed stop with a failed run-intent read is bookkeeping, not an unconfirmed stop"
    );
    assert!(
        released.is_ok(),
        "Restore must not stay refused after the Core stop is confirmed"
    );
    Ok(())
}

struct RecordingTransition {
    events: Vec<&'static str>,
    active_owner: ActiveOwnerState,
    running_pid: u32,
    next_owner: ActiveOwnerState,
    clear_fails: bool,
    stop_fails: bool,
    apply_falls_back: bool,
}

impl OwnerProxyTransition for RecordingTransition {
    async fn clear_previous_proxy(&mut self) -> anyhow::Result<()> {
        self.events.push("clear_proxy");
        if self.clear_fails {
            anyhow::bail!("clear failed");
        }
        Ok(())
    }

    async fn compensate_direct(&mut self) -> anyhow::Result<()> {
        self.events.push("compensate_direct");
        Ok(())
    }

    async fn stop_previous_core(&mut self) -> anyhow::Result<()> {
        self.events.push("stop_a");
        if self.stop_fails {
            anyhow::bail!("stop failed");
        }
        self.running_pid = 0;
        Ok(())
    }

    async fn start_new_core(&mut self) -> anyhow::Result<()> {
        self.events.push("start_b");
        self.running_pid = 202;
        Ok(())
    }

    async fn commit_new_owner(&mut self) -> anyhow::Result<ActiveOwnerState> {
        self.events.push("commit_b");
        self.active_owner = self.next_owner.clone();
        Ok(self.active_owner.clone())
    }

    async fn apply_new_proxy(&mut self) -> anyhow::Result<ProxyApplyOutcome> {
        self.events.push("apply_b");
        if self.apply_falls_back {
            self.events.push("compensate_direct");
            return Ok(ProxyApplyOutcome::DirectFallback {
                message: "apply failed".to_owned(),
            });
        }
        Ok(ProxyApplyOutcome::Applied)
    }
}

fn recording_transition() -> RecordingTransition {
    RecordingTransition {
        events: Vec::new(),
        active_owner: ActiveOwnerState::from(&owner(96_001)),
        running_pid: 101,
        next_owner: ActiveOwnerState::from(&owner(96_002)),
        clear_fails: false,
        stop_fails: false,
        apply_falls_back: false,
    }
}

#[tokio::test]
async fn owner_proxy_transition_successful_takeover_has_exact_order() -> anyhow::Result<()> {
    let mut transition = recording_transition();

    let (_, outcome) = owner_proxy_transition(&mut transition).await?;

    assert_eq!(
        transition.events,
        ["clear_proxy", "stop_a", "start_b", "commit_b", "apply_b"]
    );
    assert_eq!(transition.active_owner.owner_key, "96002");
    assert_eq!(transition.running_pid, 202);
    assert_eq!(outcome, ProxyApplyOutcome::Applied);
    Ok(())
}

#[tokio::test]
async fn owner_proxy_transition_clear_failure_preserves_old_owner_and_core() {
    let mut transition = recording_transition();
    transition.clear_fails = true;

    let error = owner_proxy_transition(&mut transition)
        .await
        .expect_err("proxy clear failure must abort takeover");

    assert_eq!(error.code, ServiceErrorCode::ProxyClearFailed);
    assert_eq!(transition.events, ["clear_proxy", "compensate_direct"]);
    assert_eq!(transition.active_owner.owner_key, "96001");
    assert_eq!(transition.running_pid, 101);
}

#[tokio::test]
async fn owner_proxy_transition_stop_failure_preserves_old_owner() {
    let mut transition = recording_transition();
    transition.stop_fails = true;

    let error = owner_proxy_transition(&mut transition)
        .await
        .expect_err("core stop failure must abort takeover");

    assert_eq!(error.code, ServiceErrorCode::OwnerSwitchFailed);
    assert_eq!(transition.events, ["clear_proxy", "stop_a"]);
    assert_eq!(transition.active_owner.owner_key, "96001");
    assert_eq!(transition.running_pid, 101);
}

#[tokio::test]
async fn owner_proxy_transition_apply_failure_keeps_new_owner_and_core() -> anyhow::Result<()> {
    let mut transition = recording_transition();
    transition.apply_falls_back = true;

    let (active, outcome) = owner_proxy_transition(&mut transition).await?;

    assert_eq!(active.owner_key, "96002");
    assert_eq!(transition.active_owner.owner_key, "96002");
    assert_eq!(transition.running_pid, 202);
    assert_eq!(
        outcome,
        ProxyApplyOutcome::DirectFallback {
            message: "apply failed".to_owned(),
        }
    );
    Ok(())
}

#[test]
fn transport_write_timeout_never_undercuts_a_handler_step() {
    // The transport drops a handler future on expiry; a mutating handler cancelled
    // mid-transaction releases its locks while detached blocking work keeps running.
    // Keep the transport bound comfortably above the per-step handler budget.
    assert!(IPC_TRANSPORT_WRITE_TIMEOUT >= IPC_HANDLER_TIMEOUT * 4);
}

#[test]
fn windows_control_pipe_admits_interactive_logons_only() {
    // Read/write for interactive logons, and nothing wider: Authenticated Users would
    // include network logons on a domain machine, and Everyone needs no explanation.
    assert!(WINDOWS_CONTROL_PIPE_SDDL.contains("0x0012019b;;;IU)"));
    assert!(!WINDOWS_CONTROL_PIPE_SDDL.contains(";;;AU)"));
    assert!(!WINDOWS_CONTROL_PIPE_SDDL.contains(";;;WD)"));
    // Network logons are denied outright, and the deny ACE must precede every allow ACE
    // for Windows to evaluate it first.
    let deny_network = WINDOWS_CONTROL_PIPE_SDDL
        .find("(D;;GA;;;NU)")
        .expect("network logons are denied");
    let first_allow = WINDOWS_CONTROL_PIPE_SDDL
        .find("(A;")
        .expect("the descriptor grants somebody");
    assert!(deny_network < first_allow);
    // The pipe stays protected, so no inherited ACE can widen it.
    assert!(WINDOWS_CONTROL_PIPE_SDDL.starts_with("D:P"));
    // Clients get read/write, never the right to create a new pipe instance.
    assert!(!WINDOWS_CONTROL_PIPE_SDDL.contains("0x0012019f;;;IU"));
}

#[tokio::test]
#[serial]
async fn non_active_owner_receives_stable_error() -> anyhow::Result<()> {
    let active = owner(92_001);
    let inactive = owner(92_002);
    commit_active_owner_session(&active, &"10".repeat(32)).await?;

    let error = require_active_owner(&inactive)
        .await
        .expect_err("non-active owner must be rejected");

    assert_eq!(error.code, ServiceErrorCode::NotActive);
    clear_active_owner().await?;
    Ok(())
}

#[tokio::test]
#[serial]
async fn same_owner_new_session_invalidates_old_proof() -> anyhow::Result<()> {
    clear_active_owner().await?;
    let owner = owner(95_001);
    let first = commit_active_owner_session(&owner, &"11".repeat(32)).await?;
    let first_proof = OwnerSessionProof {
        generation: first.generation,
        token: "11".repeat(32),
    };
    require_active_session(&owner, &first_proof).await?;
    let second = commit_active_owner_session(&owner, &"22".repeat(32)).await?;
    assert!(second.generation > first.generation);
    assert_eq!(
        require_active_session(&owner, &first_proof)
            .await
            .expect_err("old proof must be stale")
            .code,
        ServiceErrorCode::StaleOwnerSession,
    );
    clear_active_owner().await?;
    Ok(())
}

#[tokio::test]
#[serial]
async fn legacy_active_owner_session_fails_closed() -> anyhow::Result<()> {
    clear_active_owner().await?;
    let owner = owner(95_002);
    persist_active_owner(&owner).await?;
    let proof = OwnerSessionProof {
        generation: 0,
        token: "55".repeat(32),
    };

    assert_eq!(
        require_active_session(&owner, &proof)
            .await
            .expect_err("legacy owner must not authenticate a session")
            .code,
        ServiceErrorCode::StaleOwnerSession,
    );
    clear_active_owner().await?;
    Ok(())
}

#[tokio::test]
#[serial]
async fn disconnect_path_gates_stay_open_after_stop_clears_the_owner_record()
-> anyhow::Result<()> {
    clear_active_owner().await?;
    let active = owner(97_001);
    commit_active_owner_session(&active, &"33".repeat(32)).await?;

    // A successful stop invalidates the session AND deletes the active-owner record...
    clear_active_owner().await?;
    assert!(load_active_owner().await?.is_none());

    // ...so mutating disconnect routes use the armed-policy gate rather than the active
    // owner/session gate. With no armed policy in this unit test it admits the authenticated
    // owner; in production it checks the persisted WFP owner while holding the lifecycle
    // lock. Requiring an active session here would recreate the Protected Offline deadlock.
    let guard =
        super::enter_owner_lifecycle(&active, super::OwnerLifecycleGate::ArmedPolicyOwner)
            .await;
    assert!(
        matches!(guard, std::ops::ControlFlow::Continue(_)),
        "the release gate must stay open after stop cleared the owner record"
    );
    drop(guard);
    Ok(())
}

/// Installs an installed-App image proof that cannot complete, as a transient registry or ACL
/// read failure would, and restores the previous proof on drop.
#[cfg(all(windows, feature = "test"))]
fn unproven_app_image() -> impl Drop {
    fn unproven(
        _: &AuthenticatedOwner,
    ) -> std::result::Result<(), crate::core::auth::ServiceError> {
        Err(super::app_identity_unproven(
            "installation tree file held open by another process",
        ))
    }
    struct Restore(super::AppPeerProof);
    impl Drop for Restore {
        fn drop(&mut self) {
            super::replace_test_app_peer_proof(self.0);
        }
    }
    Restore(super::replace_test_app_peer_proof(unproven))
}

/// Connect-side routes enter through `enter_protecting_owner_lifecycle`, so that is where the
/// installed-App image proof has to be applied; deleting the call must fail this test. A proof
/// that could not be completed must reach the App as the retryable 503, not as the 401 that
/// means "not the Tono App".
#[cfg(all(windows, feature = "test"))]
#[tokio::test]
#[serial]
async fn lifecycle_entry_refuses_when_the_app_image_proof_cannot_complete() {
    let _restore = unproven_app_image();

    let entered = super::enter_protecting_owner_lifecycle(
        &owner(92_010),
        super::OwnerLifecycleGate::ArmedPolicyTakeover,
    )
    .await;

    let std::ops::ControlFlow::Break(response) = entered else {
        panic!("the protecting lifecycle entry must apply the App image proof");
    };
    let response = response.expect("the refusal encodes as a response");
    assert_eq!(response.status, http::StatusCode::SERVICE_UNAVAILABLE);
}

/// Release must never be refused by the image proof: refusing it while WFP is armed would keep
/// the machine off the network (decision 031). The `ReleaseKillSwitch` route enters with the
/// `ArmedPolicyRelease` gate through `enter_owner_lifecycle`, which must admit it even when the
/// proof would fail.
#[cfg(all(windows, feature = "test"))]
#[tokio::test]
#[serial]
async fn release_entry_proceeds_when_the_app_image_proof_fails() {
    let _restore = unproven_app_image();

    let entered = super::enter_owner_lifecycle(
        &owner(92_011),
        super::OwnerLifecycleGate::ArmedPolicyRelease,
    )
    .await;

    assert!(
        matches!(entered, std::ops::ControlFlow::Continue(_)),
        "a failed App image proof must not refuse Release"
    );
}

#[tokio::test]
#[serial]
async fn accepted_goodbye_refuses_new_lifecycle_work_before_its_response_grace() {
    struct ResetGoodbye;
    impl Drop for ResetGoodbye {
        fn drop(&mut self) {
            super::OWNER_GOODBYE_PENDING.store(false, std::sync::atomic::Ordering::SeqCst);
        }
    }
    let _reset = ResetGoodbye;
    let reserved_before_unlock = {
        let _lifecycle = super::OWNER_LIFECYCLE_LOCK.lock().await;
        super::owner_goodbye_verdict(false, Some(false)).expect("an idle daemon may stop");
        super::schedule_owner_goodbye_shutdown();
        // No await between scheduling and this sample: the response-grace task cannot run yet.
        super::lifecycle_is_stopping()
    };
    let result = super::enter_owner_lifecycle(&owner(97_004), super::OwnerLifecycleGate::Unchecked).await;
    match result {
        std::ops::ControlFlow::Break(response) => {
            let response = response.expect("a shutdown refusal must encode");
            assert_eq!(response.status, http::StatusCode::SERVICE_UNAVAILABLE);
        }
        std::ops::ControlFlow::Continue(_) => panic!("a goodbye-reserved process admitted lifecycle work"),
    }
    assert!(super::lifecycle_is_stopping(), "shutdown must stay reserved");
    assert!(reserved_before_unlock, "shutdown must be reserved before dropping the lifecycle lock");
}

#[test]
fn scm_stop_releases_when_the_repair_gate_cannot_be_opened() {
    let unreadable: anyhow::Result<Option<()>> = Err(anyhow::anyhow!("failed to open service repair gate"));
    assert!(
        !super::installer_holds_repair_gate(&unreadable),
        "a gate I/O error is not an installer; stop must not keep protection on it"
    );
    assert!(super::installer_holds_repair_gate::<()>(&Ok(None)), "a gate held elsewhere still fences stop");
}
