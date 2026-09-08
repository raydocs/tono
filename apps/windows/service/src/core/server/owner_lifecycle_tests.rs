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
    }
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
