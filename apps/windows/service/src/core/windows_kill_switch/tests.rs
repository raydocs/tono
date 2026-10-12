use super::*;
use crate::core::structure::{KillSwitchConfig, ProxyEndpoint, ProxyProtocol};
use serial_test::serial;

#[test]
fn a_lost_committed_direct_lease_releases_unless_the_kill_switch_is_strict() {
    let expired = "committed DIRECT heartbeat lease expired after App/session liveness was lost";
    assert!(committed_direct_lease_failure_releases(expired, false));
    assert!(!committed_direct_lease_failure_releases(expired, true));
    assert!(!committed_direct_lease_failure_releases(
        "pending DIRECT endpoints expired before App finalization",
        false,
    ));
}

/// Stop is accepted while startup can still be inside DNS restore, and an
/// unverified retirement can run that restore again. The posted hint is
/// shorter than those two budgets, so the checkpoint has to be refreshed
/// inside a single budget.
#[test]
fn scm_stop_hint_refreshes_before_a_dns_restore_can_outlive_it() {
    assert!(
        SCM_STOP_WAIT_HINT < DNS_RESTORE_TIMEOUT.saturating_mul(2),
        "one wait hint cannot cover startup restore plus unverified retirement"
    );
    assert!(SCM_STOP_HINT_REFRESH < DNS_RESTORE_TIMEOUT);
    assert!(SCM_STOP_HINT_REFRESH < SCM_STOP_WAIT_HINT);
    assert!(stop_pending_refresh_due(SCM_STOP_HINT_REFRESH));
    assert!(!stop_pending_refresh_due(
        SCM_STOP_HINT_REFRESH - std::time::Duration::from_secs(1)
    ));
}

/// Scoped failure seams: reset even when an assertion panics so the serial suite cannot be
/// poisoned for every later WFP/persistence test.
struct SimulatedStateFailures;

impl SimulatedStateFailures {
    fn arm_removal() -> Self {
        TEST_REMOVE_FAILURE.store(true, Ordering::Relaxed);
        Self
    }

    fn arm(persist: bool, install: bool) -> Self {
        TEST_PERSIST_ATTEMPTS.store(0, Ordering::Relaxed);
        TEST_INSTALL_ATTEMPTS.store(0, Ordering::Relaxed);
        TEST_PERSIST_FAILURE.store(persist, Ordering::Relaxed);
        TEST_INSTALL_FAILURE.store(install, Ordering::Relaxed);
        TEST_AMBIGUOUS_INSTALL_FAILURE.store(false, Ordering::Relaxed);
        Self
    }

    fn arm_ambiguous_install() -> Self {
        TEST_PERSIST_ATTEMPTS.store(0, Ordering::Relaxed);
        TEST_INSTALL_ATTEMPTS.store(0, Ordering::Relaxed);
        TEST_PERSIST_FAILURE.store(false, Ordering::Relaxed);
        TEST_INSTALL_FAILURE.store(false, Ordering::Relaxed);
        TEST_AMBIGUOUS_INSTALL_FAILURE.store(true, Ordering::Relaxed);
        Self
    }
}

impl Drop for SimulatedStateFailures {
    fn drop(&mut self) {
        TEST_REMOVE_FAILURE.store(false, Ordering::Relaxed);
        TEST_PERSIST_FAILURE.store(false, Ordering::Relaxed);
        TEST_INSTALL_FAILURE.store(false, Ordering::Relaxed);
        TEST_AMBIGUOUS_INSTALL_FAILURE.store(false, Ordering::Relaxed);
    }
}

fn test_config() -> KillSwitchConfig {
    KillSwitchConfig {
        tunnel_interface: "Tono".to_owned(),
        proxy_endpoints: vec![ProxyEndpoint {
            ip: "8.8.8.8".to_owned(),
            port: 443,
            protocol: ProxyProtocol::Tcp,
        }],
        bootstrap_api_hosts: vec!["1.1.1.1".to_owned()],
        direct_endpoints: Vec::new(),
    }
}

fn test_config_with_direct() -> KillSwitchConfig {
    KillSwitchConfig {
        direct_endpoints: vec![
            ProxyEndpoint {
                ip: "9.0.0.9".to_owned(),
                port: 443,
                protocol: ProxyProtocol::Tcp,
            },
            ProxyEndpoint {
                ip: "9.0.0.10".to_owned(),
                port: 8000,
                protocol: ProxyProtocol::Udp,
            },
        ],
        ..test_config()
    }
}

/// What a watchdog tick renders for this session right now.
async fn render(armed: &Armed) -> RuleConfig {
    rule_config_rendering(armed, current_core_instance().await)
}

fn dns_snapshot_path() -> PathBuf {
    crate::service_paths()
        .persistent_state_dir()
        .join("protected-dns.json")
}

fn valid_intent(mode: KillSwitchStatusMode, wanted: bool) -> IntentRecord {
    IntentRecord {
        wanted,
        mode,
        // Existing tests use this as an established-session fixture; migration behavior is
        // covered separately with JSON that omits the field.
        verified: Some(true),
        tunnel_interface: "Tono".to_owned(),
        app_path: "/opt/tono/mihomo".to_owned(),
        endpoints: test_config().proxy_endpoints,
        api_host_ips: vec!["1.1.1.1".to_owned()],
        updated_at: 1,
        owner_key: None,
        strict_kill_switch: false,
        reconnect_after_release: false,
        reconnect_owner_key: None,
        apply_narrow_after_release: None,
    }
}

#[test]
fn legacy_verification_migration_depends_on_mode() {
    for (mode, expected) in [
        (KillSwitchStatusMode::Locked, true),
        (KillSwitchStatusMode::Blocked, false),
        (KillSwitchStatusMode::Bootstrap, false),
    ] {
        let mut value = serde_json::to_value(valid_intent(mode, true)).unwrap();
        value.as_object_mut().unwrap().remove("verified");
        let intent: IntentRecord = serde_json::from_value(value).unwrap();
        assert_eq!(intent.verified, None);
        assert_eq!(intent.is_verified(), expected, "{mode:?}");
    }
}

#[tokio::test]
#[serial]
async fn a_failed_arm_keeps_the_existing_secondary_ai_hold() -> Result<()> {
    cleanup().await;
    crate::core::selective_layer::finish_release(true).await;
    let failures = SimulatedStateFailures::arm(false, true);

    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice")
        .await
        .expect_err("the live WFP installation fails");
    assert!(
        crate::core::selective_layer::test_hold_active(),
        "a failed replacement barrier must not remove the existing AI hold"
    );

    drop(failures);
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    assert!(status().await.wanted);
    assert!(
        !crate::core::selective_layer::test_hold_active(),
        "a successful replacement removes the sinkhole so tunnel DNS can work"
    );
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn fresh_arm_releases_after_app_verification_never_arrives() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    assert_eq!(
        reconcile_wanted_core_window_unlocked().await?,
        WantedCoreWindow::Keep,
        "StartClash must have time to publish Core after arming"
    );
    let deadline = *WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let deadline = deadline.expect("a fresh arm must bound an interrupted Connect");
    assert!(
        deadline > std::time::Instant::now() + std::time::Duration::from_secs(310),
        "the service must allow the App's complete cold-connect budget"
    );
    // StartClash completed, but the App died before the separate Lock/MarkVerified IPCs.
    let owner = crate::core::auth::AuthenticatedOwner {
        key: "owner-alice".to_owned(),
        identity: crate::OwnerIdentity::Unix { uid: 97005, gid: 20 },
        app_data_root: std::env::temp_dir(),
        peer_pid: None,
        peer_session_id: None,
    };
    crate::core::desired::persist_owner_core_started(&owner, &crate::ClashConfig::default())
        .await?;
    crate::core::desired::persist_active_owner(&owner).await?;
    crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
        .await;
    assert_eq!(
        reconcile_wanted_core_window_unlocked().await?,
        WantedCoreWindow::Keep
    );
    *WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(std::time::Instant::now());
    spawn_windows_kill_switch_watchdog();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let intent = tokio::fs::read(intent_path()).await.ok()
                .and_then(|bytes| serde_json::from_slice::<IntentRecord>(&bytes).ok());
            if !status().await.wanted
                && crate::core::selective_layer::test_hold_active()
                && intent.is_some_and(|intent| !intent.wanted && intent.reconnect_after_release)
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the watchdog must retire an abandoned Connect");
    assert!(current_core_instance().await.is_none(), "Core must stop before WFP opens");
    assert!(!crate::core::desired::load_owner_desired_state(&owner.key).await?.core_should_be_running);
    assert!(crate::core::desired::load_active_owner().await?.is_none());
    assert!(crate::core::selective_layer::test_hold_active());
    let intent: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
    assert!(!intent.wanted);
    assert!(intent.reconnect_after_release);
    assert!(lock(None).await.is_err(), "a late Lock cannot revive the expired arm");
    tokio::fs::remove_file(crate::service_paths().for_owner_key(&owner.key).desired_state_path()).await?;
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn automatic_pending_update_disconnect_retains_the_ai_hold() -> Result<()> {
    cleanup().await;
    locked_direct_test_session().await?;
    let request = crate::update_wire::UpdateRequest::disconnect(true);
    let wire = serde_json::to_vec(&request)?;
    let received: crate::update_wire::UpdateRequest = serde_json::from_slice(&wire)?;
    let released = release_for_update_disconnect(received.applies_narrow_on_disconnect()).await?;
    let ai_held = crate::core::selective_layer::test_hold_active();
    cleanup().await;
    assert!(!released.wanted, "automatic failed-update cleanup must release general traffic");
    assert!(ai_held, "pending-update dispatch must not lose automatic cleanup's AI hold");
    Ok(())
}

#[tokio::test]
#[serial]
async fn automatic_pending_update_disconnect_preserves_strict_protection() -> Result<()> {
    cleanup().await;
    locked_direct_test_session().await?;
    armed_guard().as_mut().unwrap().intent.strict_kill_switch = true;
    let result = release_for_update_disconnect(true).await;
    let wanted = status().await.wanted;
    cleanup().await;
    assert!(result.is_err(), "automatic cleanup cannot release strict protection");
    assert!(wanted);
    Ok(())
}

#[tokio::test]
#[serial]
async fn fresh_arm_verification_retires_the_connect_deadline() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
        .await;
    lock(None).await?;
    assert!(WANTED_CORE_DEADLINE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).is_some());
    mark_verified("owner-alice").await?;
    assert!(WANTED_CORE_DEADLINE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).is_none());
    // A reconnect inherits verified=true, but still needs its own App proof.
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    lock(None).await?;
    assert!(WANTED_CORE_DEADLINE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).is_some());
    mark_verified("owner-alice").await?;
    assert!(WANTED_CORE_DEADLINE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).is_none());
    assert!(status().await.wanted);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn inherited_verification_cannot_acknowledge_a_fresh_arm() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
        .await;
    lock(None).await?;
    mark_verified("owner-alice").await?;
    assert!(status().await.verified);

    // The new arm retains durable reconnect evidence, but no new MarkVerified arrived.
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    lock(None).await?;
    assert!(armed_guard().as_ref().unwrap().intent.is_verified());
    let readback = status().await;
    assert!(readback.wanted && readback.tunnel_permit_rendered);
    assert_eq!(readback.mode, KillSwitchStatusMode::Locked);
    assert!(!readback.verified, "a lost request cannot be acknowledged by its predecessor's proof");
    assert!(FRESH_ARM_PROOF_PENDING.load(Ordering::Acquire));

    mark_verified("owner-alice").await?;
    assert!(status().await.verified, "a lost reply can still be acknowledged by fresh proof");
    assert!(!FRESH_ARM_PROOF_PENDING.load(Ordering::Acquire));
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn fresh_arm_expiry_cannot_retire_a_successor_connect() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    let expired_epoch = FRESH_ARM_EPOCH.load(Ordering::Acquire);
    *WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(std::time::Instant::now());
    assert!(expired_fresh_arm_owner(expired_epoch).is_some());
    // The old expiry queued for lifecycle while a successor Connect acquired it first.
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4243, 2)))
        .await;
    crate::core::server::retire_expired_fresh_arm(expired_epoch).await?;
    assert!(status().await.wanted);
    assert_eq!(current_core_instance().await, Some(CoreInstance { pid: 4243, generation: 2 }));
    assert!(!crate::core::selective_layer::test_hold_active());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn update_held_startup_barrier_releases_with_the_ai_hold() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    // As restored at Service start: unverified, no core window, held by a pending update
    // whose executor is gone (#1292).
    clear_wanted_core_window();
    STARTUP_UNVERIFIED_BARRIER.store(true, Ordering::Release);
    STARTUP_SETTLED.store(true, Ordering::Release);
    let (withdrawn, fenced, released) = {
        let _operation = WFP_OPERATION.lock().await;
        owe_update_held_startup_release_unlocked(|| true);
        // A recovery owner registered before the removal attempt: the expiry is withdrawn.
        owe_update_held_startup_release_unlocked(|| false);
        let withdrawn = reconcile_wanted_core_window_unlocked().await;
        let kept = status().await.wanted;
        // The re-check under the store fence no longer owes it: this attempt aborts.
        owe_update_held_startup_release_unlocked(|| true);
        *TEST_UPDATE_FENCE_OWED.lock().unwrap() = Some(false);
        let fenced =
            reconcile_wanted_core_window_unlocked().await.is_err() && status().await.wanted;
        *TEST_UPDATE_FENCE_OWED.lock().unwrap() = Some(true);
        (
            withdrawn.map(|_| kept),
            fenced,
            reconcile_wanted_core_window_unlocked().await,
        )
    };
    *TEST_UPDATE_FENCE_OWED.lock().unwrap() = None;
    let wanted = status().await.wanted;
    let held = crate::core::selective_layer::test_hold_active();
    STARTUP_UNVERIFIED_BARRIER.store(false, Ordering::Release);
    cleanup().await;

    assert!(withdrawn?, "a release no longer owed must not remove WFP");
    assert!(fenced, "a fence that no longer owes the release keeps WFP");
    released?;
    assert!(
        !wanted,
        "an update-held barrier must not leave a non-strict machine Blocked"
    );
    assert!(held, "the release keeps AI blocked");
    Ok(())
}

#[tokio::test]
#[serial]
async fn fresh_arm_expiry_releases_when_another_owner_holds_the_core_record() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    let bob = crate::core::auth::AuthenticatedOwner {
        key: "owner-bob".to_owned(),
        identity: crate::OwnerIdentity::Unix { uid: 97_011, gid: 20 },
        app_data_root: std::env::temp_dir(),
        peer_pid: None,
        peer_session_id: None,
    };
    crate::core::desired::persist_active_owner(&bob).await?;
    crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4251, 1)))
        .await;
    *WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(std::time::Instant::now());

    let retired = crate::core::server::retire_expired_fresh_arm(FRESH_ARM_EPOCH.load(Ordering::Acquire)).await;
    let wanted = status().await.wanted;
    let held = crate::core::selective_layer::test_hold_active();
    let core = current_core_instance().await;
    let active = crate::core::desired::load_active_owner().await?;
    crate::core::desired::clear_active_owner().await?;
    cleanup().await;

    retired?;
    assert!(!wanted, "an expired arm must not stay Blocked over a foreign owner record");
    assert!(held, "the release keeps AI blocked");
    assert_eq!(core, Some(CoreInstance { pid: 4251, generation: 1 }), "another owner's Core is not stopped");
    assert_eq!(active.map(|owner| owner.owner_key).as_deref(), Some("owner-bob"));
    Ok(())
}

#[tokio::test]
#[serial]
async fn fresh_arm_expiry_releases_when_the_run_intent_cannot_be_retired() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    // A directory where the desired-state file belongs: every read and write of it fails,
    // like a persistent ProgramData ACL or AV-handle failure.
    let desired = crate::core::paths::service_paths()
        .for_owner_key("owner-alice")
        .desired_state_path();
    tokio::fs::create_dir_all(&desired).await?;
    let alice = crate::core::auth::AuthenticatedOwner {
        key: "owner-alice".to_owned(),
        identity: crate::OwnerIdentity::Unix {
            uid: 97_013,
            gid: 20,
        },
        app_data_root: std::env::temp_dir(),
        peer_pid: None,
        peer_session_id: None,
    };
    crate::core::desired::persist_active_owner(&alice).await?;
    *WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(std::time::Instant::now());

    // The intent store fails too, so the release cannot write its tombstone.
    let failures = SimulatedStateFailures::arm(true, false);
    let retired =
        crate::core::server::retire_expired_fresh_arm(FRESH_ARM_EPOCH.load(Ordering::Acquire))
            .await;
    let wanted = status().await.wanted;
    let held = crate::core::selective_layer::test_hold_active();
    drop(failures);
    // The fault clears and the Service restarts in the same boot.
    let restarted = restore_on_service_start().await;
    let wanted_after_restart = status().await.wanted;
    let active = crate::core::desired::load_active_owner().await;
    let _ = crate::core::desired::clear_active_owner().await;
    tokio::fs::remove_dir_all(&desired).await?;
    cleanup().await;

    assert!(
        retired.is_err(),
        "the unwritten tombstone is still reported: {retired:?}"
    );
    assert!(
        !wanted,
        "a stopped abandoned Connect must not stay Blocked on a run-intent write failure"
    );
    assert!(held, "the release keeps AI blocked");
    restarted?;
    assert!(
        !wanted_after_restart,
        "a same-boot restart must not restore the retired session's barrier"
    );
    assert!(
        active?.is_none(),
        "the active owner is cleared even though the run intent could not be written"
    );
    Ok(())
}

#[tokio::test]
#[serial]
async fn fresh_arm_deadline_preserves_explicit_strict_protection() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    armed_guard().as_mut().unwrap().intent.strict_kill_switch = true;
    *WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(std::time::Instant::now());
    assert_eq!(
        reconcile_wanted_core_window_unlocked().await?,
        WantedCoreWindow::Keep
    );
    assert!(status().await.wanted);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn exhausted_core_notification_cannot_expire_a_successor_arm() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    let exhausted_epoch = core_arm_epoch();
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    let successor_deadline = *WANTED_CORE_DEADLINE.lock().unwrap();
    note_core_recovery_exhausted(exhausted_epoch).await;
    assert_eq!(*WANTED_CORE_DEADLINE.lock().unwrap(), successor_deadline);
    assert!(expired_fresh_arm_owner(core_arm_epoch()).is_none());
    assert!(status().await.wanted);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn exhausted_core_notification_preserves_explicit_strict_protection() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    armed_guard().as_mut().unwrap().intent.strict_kill_switch = true;
    clear_wanted_core_window();
    note_core_recovery_exhausted(core_arm_epoch()).await;
    assert!(WANTED_CORE_DEADLINE.lock().unwrap().is_none());
    assert!(status().await.wanted);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn arm_inherits_verification_only_for_same_owner() -> Result<()> {
    cleanup().await;
    locked_direct_test_session().await?;
    mark_verified("owner-alice").await?;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    assert!(ARMED.lock().unwrap().as_ref().unwrap().intent.is_verified());
    TEST_OWNER_SIGNED_OUT.store(true, Ordering::Relaxed);
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-bob").await?;
    assert!(!ARMED.lock().unwrap().as_ref().unwrap().intent.is_verified());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn mark_verified_requires_locked_matching_owner_and_is_idempotent() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    assert!(mark_verified("owner-alice").await.is_err());
    crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
        .await;
    lock(None).await?;
    assert!(mark_verified("owner-bob").await.is_err());
    mark_verified("owner-alice").await?;
    mark_verified("owner-alice").await?;
    assert!(ARMED.lock().unwrap().as_ref().unwrap().intent.is_verified());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn mark_verified_recovers_a_poisoned_armed_lock() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
        .await;
    lock(None).await?;

    struct ClearPoison;
    impl Drop for ClearPoison {
        fn drop(&mut self) {
            ARMED.clear_poison();
        }
    }
    let poison = ClearPoison;
    assert!(
        std::thread::spawn(|| {
            let _armed = ARMED.lock().unwrap();
            panic!("simulate a panic while holding ARMED");
        })
        .join()
        .is_err()
    );
    assert!(ARMED.is_poisoned());

    mark_verified("owner-alice").await?;

    assert!(armed_guard().as_ref().unwrap().intent.is_verified());
    let persisted: IntentRecord =
        serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
    assert_eq!(persisted.verified, Some(true));
    assert_eq!(persisted.owner_key.as_deref(), Some("owner-alice"));
    drop(poison);
    cleanup().await;
    Ok(())
}

/// A corrupt snapshot only refuses a restore while the machine is still resolving through
/// the loopback core; off Windows that answer comes from a test hook, so tests that mean
/// "restore is unprovable" must say so explicitly.
fn simulate_machine_still_on_loopback_dns() {
    crate::core::dns::test_hooks::set_live_dns_on_loopback(true);
}

async fn assert_disarmed_tombstone_present() -> Result<()> {
    let intent: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
    assert!(
        !intent.wanted,
        "explicit release must leave wanted=false evidence"
    );
    assert!(intent.owner_key.is_none());
    assert!(intent.endpoints.is_empty());
    Ok(())
}

async fn cleanup() {
    crate::core::selective_layer::remove().await;
    TEST_INTERRUPT_RELEASE_FOLLOW_UP.store(false, Ordering::SeqCst);
    AI_HOLD_UNCONFIRMED_BEFORE_RELEASE.store(false, Ordering::SeqCst);
    *RELEASE_DEADLINE.lock().unwrap() = None;
    *RELEASE_AI_HOLD_NOTE.lock().unwrap() = None;
    TEST_REMOVE_FAILURE.store(false, Ordering::Relaxed);
    TEST_REMOVE_ATTEMPTS.store(0, Ordering::Relaxed);
    TEST_RESIDUAL_FILTER_KEYS.lock().unwrap().clear();
    TEST_PERSIST_FAILURE.store(false, Ordering::Relaxed);
    TEST_INSTALL_FAILURE.store(false, Ordering::Relaxed);
    TEST_AMBIGUOUS_INSTALL_FAILURE.store(false, Ordering::Relaxed);
    TEST_INTENT_VERIFY_CORRUPT.store(false, Ordering::Relaxed);
    TEST_PERSIST_ATTEMPTS.store(0, Ordering::Relaxed);
    TEST_INSTALL_ATTEMPTS.store(0, Ordering::Relaxed);
    TEST_OWNER_SIGNED_OUT.store(false, Ordering::Relaxed);
    crate::core::dns::test_hooks::set_live_dns_on_loopback(false);
    crate::core::manager::set_running_core_identity_for_kill_switch_tests(None).await;
    *ARMED.lock().unwrap() = None;
    *LAST_ERROR.lock().unwrap() = None;
    *LAST_VERIFY.lock().unwrap() = None;
    RESTORE_WAS_LOCKED.store(false, Ordering::Release);
    RESTORED_BARRIER_UNPROVEN.store(false, Ordering::Release);
    clear_wanted_core_window();
    publish_reconnect(false, None);
    CRASH_TOMBSTONE_PENDING.store(false, Ordering::Release);
    CORE_REPLAY_EXPECTED.store(false, Ordering::Release);
    #[cfg(test)]
    TEST_CORE_STARTING.store(false, Ordering::Release);
    for path in [
        intent_path(),
        dns_snapshot_path(),
        crate::service_paths().active_owner_path(),
    ] {
        match tokio::fs::remove_file(path).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => panic!("test cleanup failed: {error}"),
        }
    }
}

#[tokio::test]
#[serial]
async fn restore_with_valid_wanted_intent_rearms_and_downgrades_locked() -> Result<()> {
    cleanup().await;
    TEST_CORE_STARTING.store(true, Ordering::Relaxed);
    let intent = valid_intent(KillSwitchStatusMode::Locked, true);
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

    restore_on_service_start().await?;

    let armed = ARMED.lock().unwrap().clone().expect("must be re-armed");
    assert_eq!(
        armed.intent.mode,
        KillSwitchStatusMode::Blocked,
        "a persisted Locked mode downgrades to Blocked until lock runs again"
    );
    assert!(armed.tun_luid.is_none());
    // The downgrade is persisted too.
    let on_disk: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
    assert_eq!(on_disk.mode, KillSwitchStatusMode::Blocked);
    assert_eq!(on_disk.verified, Some(true));
    assert!(status().await.wanted);
    cleanup().await;
    Ok(())
}

/// A restored verified wanted block is released at once when Core is neither
/// running nor starting. While Core is starting, it stays up only until
/// [`WANTED_CORE_PROOF_WINDOW`]. Needs real-hardware calibration of that cap.
#[tokio::test]
#[serial]
async fn wanted_session_releases_when_core_is_not_proven_in_time() -> Result<()> {
    assert_eq!(WANTED_CORE_PROOF_WINDOW, std::time::Duration::from_secs(30));
    assert_eq!(
        wanted_core_window_action(true, false, true, false),
        WantedCoreWindow::Keep,
        "an explicit strict kill switch keeps the restored block"
    );
    assert_eq!(
        wanted_core_window_action(false, false, false, false),
        WantedCoreWindow::Release,
        "a Core that is neither running nor starting is released immediately"
    );
    assert_eq!(
        wanted_core_window_action(false, true, false, false),
        WantedCoreWindow::Keep,
        "a starting Core keeps the block until the cap"
    );
    assert_eq!(
        wanted_core_window_action(false, true, true, false),
        WantedCoreWindow::Release
    );
    assert_eq!(
        wanted_core_window_action(false, true, true, true),
        WantedCoreWindow::Proven
    );
    assert!(!restored_connection_proven(
        false,
        true,
        KillSwitchStatusMode::Locked,
        true
    ));
    assert!(restored_connection_proven(
        true,
        true,
        KillSwitchStatusMode::Locked,
        true
    ));

    cleanup().await;
    let intent = valid_intent(KillSwitchStatusMode::Locked, true);
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
    restore_on_service_start().await?;
    let released = status().await;
    assert!(
        !released.wanted,
        "no Core process and no replay releases before the cap"
    );
    assert!(released.reconnect_after_release);
    assert!(
        crate::core::selective_layer::test_hold_active(),
        "an unproven Core must leave AI destinations blocked after general traffic is released"
    );
    let on_disk: IntentRecord =
        serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
    assert!(!on_disk.wanted);
    assert!(on_disk.reconnect_after_release);

    *ARMED.lock().unwrap() = None;
    RECONNECT_AFTER_RELEASE.store(false, Ordering::Release);
    restore_on_service_start().await?;
    assert!(!status().await.wanted);
    assert!(status().await.reconnect_after_release);
    assert!(
        tokio::fs::metadata(intent_path()).await.is_ok(),
        "the crash tombstone survives the next Service start"
    );

    cleanup().await;
    TEST_CORE_STARTING.store(true, Ordering::Relaxed);
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
    restore_on_service_start().await?;
    assert!(status().await.wanted, "a starting Core keeps the block");
    let deadline = WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .expect("a starting restore arms the core-proof window");
    assert!(deadline > std::time::Instant::now());
    assert_eq!(
        reconcile_wanted_core_window_unlocked().await?,
        WantedCoreWindow::Keep
    );
    TEST_CORE_STARTING.store(false, Ordering::Relaxed);
    note_core_replay_finished().await?;
    assert!(
        !status().await.wanted,
        "replay that settled with no process releases before the cap"
    );
    assert!(status().await.reconnect_after_release);

    cleanup().await;
    TEST_CORE_STARTING.store(true, Ordering::Relaxed);
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
    restore_on_service_start().await?;
    *WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) =
        Some(std::time::Instant::now() - std::time::Duration::from_secs(1));
    assert_eq!(
        reconcile_wanted_core_window_unlocked().await?,
        WantedCoreWindow::Release
    );
    assert!(!status().await.wanted);

    cleanup().await;
    let mut strict = valid_intent(KillSwitchStatusMode::Locked, true);
    strict.strict_kill_switch = true;
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&strict)?).await?;
    restore_on_service_start().await?;
    assert!(
        WANTED_CORE_DEADLINE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_none()
    );
    assert_eq!(
        reconcile_wanted_core_window_unlocked().await?,
        WantedCoreWindow::Keep
    );
    assert!(status().await.wanted, "strict keeps the block with no window");
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn startup_persist_failure_still_installs_and_publishes_blocked() -> Result<()> {
    cleanup().await;
    TEST_CORE_STARTING.store(true, Ordering::Relaxed);
    let intent = valid_intent(KillSwitchStatusMode::Locked, true);
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

    let failures = SimulatedStateFailures::arm(true, false);
    let error = restore_on_service_start()
        .await
        .expect_err("the caller must still learn that durable reconciliation failed");
    assert!(
        format!("{error:#}").contains("persistent-state write failure"),
        "{error:#}"
    );
    assert_eq!(TEST_PERSIST_ATTEMPTS.load(Ordering::Relaxed), 1);
    assert_eq!(
        TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed),
        1,
        "a persistence failure must not skip the live Blocked install"
    );
    let blocked = armed_guard()
        .clone()
        .expect("watchdog must retain conservative startup state");
    assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(blocked.direct_endpoints.is_empty());
    assert!(blocked.direct_reload.is_none());

    drop(failures);
    // The same published snapshot is sufficient for the watchdog's next healthy repair.
    install_unlocked(&blocked).await?;
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn startup_install_failure_still_persists_and_arms_watchdog_state() -> Result<()> {
    cleanup().await;
    TEST_CORE_STARTING.store(true, Ordering::Relaxed);
    let intent = valid_intent(KillSwitchStatusMode::Locked, true);
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

    let failures = SimulatedStateFailures::arm(false, true);
    let error = restore_on_service_start()
        .await
        .expect_err("an unproved live Blocked set must be reported");
    assert!(
        format!("{error:#}").contains("WFP install failure"),
        "{error:#}"
    );
    assert_eq!(TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed), 1);
    assert_eq!(
        TEST_PERSIST_ATTEMPTS.load(Ordering::Relaxed),
        1,
        "a live install failure must not skip durable Blocked persistence"
    );
    let blocked = armed_guard()
        .clone()
        .expect("failed startup install must leave watchdog state armed");
    assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
    let on_disk: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
    assert_eq!(on_disk.mode, KillSwitchStatusMode::Blocked);

    crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 99)))
        .await;
    retract_direct_before_core_replacement()
        .await
        .expect_err("replacement spawn must remain refused until exact Blocked succeeds");
    assert_eq!(
        TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed),
        2,
        "the pre-spawn barrier must retry despite an empty restored DIRECT receipt"
    );
    assert!(
        crate::core::manager::security_core_instance_snapshot().is_none(),
        "failed narrowing still freezes Core identity before returning"
    );

    drop(failures);
    install_unlocked(&blocked).await?;
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn startup_double_failure_reports_both_and_keeps_conservative_state() -> Result<()> {
    cleanup().await;
    TEST_CORE_STARTING.store(true, Ordering::Relaxed);
    let intent = valid_intent(KillSwitchStatusMode::Locked, true);
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

    let failures = SimulatedStateFailures::arm(true, true);
    let error = restore_on_service_start()
        .await
        .expect_err("neither failed proof may be hidden");
    let message = format!("{error:#}");
    assert!(
        message.contains("persistent-state write failure"),
        "{message}"
    );
    assert!(message.contains("WFP install failure"), "{message}");
    assert_eq!(TEST_PERSIST_ATTEMPTS.load(Ordering::Relaxed), 1);
    assert_eq!(TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed), 1);
    let blocked = armed_guard()
        .clone()
        .expect("even a double failure must arm watchdog reconciliation");
    assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(blocked.direct_endpoints.is_empty());

    drop(failures);
    install_unlocked(&blocked).await?;
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn legacy_locked_migration_stays_verified_across_a_second_restart() -> Result<()> {
    cleanup().await;
    // The migration is about a session Core may still return to, not the idle release.
    TEST_CORE_STARTING.store(true, Ordering::Relaxed);
    let mut value = serde_json::to_value(valid_intent(KillSwitchStatusMode::Locked, true))?;
    value.as_object_mut().unwrap().remove("verified");
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&value)?).await?;

    restore_on_service_start().await?;
    *ARMED.lock().unwrap() = None;
    restore_on_service_start().await?;

    let armed = ARMED
        .lock()
        .unwrap()
        .clone()
        .expect("must remain fail-closed");
    assert!(armed.intent.is_verified());
    assert_eq!(armed.intent.mode, KillSwitchStatusMode::Blocked);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn intent_write_isolated_tmps_and_verified_commit() -> Result<()> {
    cleanup().await;
    let dir = crate::service_paths()
        .persistent_state_dir()
        .join("intent-write-test");
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join("probe.json");

    // Sequential writes commit exactly what was asked, with no shared
    // temporary left behind for a later writer to delete or reuse.
    atomic_write(&path, b"{\"wanted\":true}").await?;
    atomic_write(&path, b"{\"wanted\":false}").await?;
    assert_eq!(tokio::fs::read(&path).await?, b"{\"wanted\":false}");
    let mut entries = tokio::fs::read_dir(&dir).await?;
    let mut names = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        names.push(entry.file_name().to_string_lossy().into_owned());
    }
    assert_eq!(
        names,
        vec!["probe.json".to_owned()],
        "unique tmps must be renamed away; a shared tmp must never exist"
    );

    // Concurrent writers never tear: the destination always holds one
    // complete write, and at least the last writer verifies its own
    // commit (a stale commit landing first is reported, not kept).
    let (first, second) = tokio::join!(
        atomic_write(&path, b"first-writer"),
        atomic_write(&path, b"second-writer")
    );
    assert!(
        first.is_ok() || second.is_ok(),
        "at least the last writer verifies its own commit"
    );
    let committed = tokio::fs::read(&path).await?;
    assert!(
        committed.as_slice() == b"first-writer"
            || committed.as_slice() == b"second-writer",
        "concurrent intent writes must never tear"
    );

    // A stale rename landing between replace and read-back is a loud
    // error, never a quiet older intent.
    TEST_INTENT_VERIFY_CORRUPT.store(true, Ordering::Relaxed);
    let error = atomic_write(&path, b"third-writer")
        .await
        .expect_err("a stale destination after replace must fail verification");
    assert!(format!("{error:#}").contains("did not commit"));

    tokio::fs::remove_dir_all(&dir).await?;
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn interrupted_automatic_release_replays_the_ai_hold_on_service_start() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    TEST_INTERRUPT_RELEASE_FOLLOW_UP.store(true, Ordering::SeqCst);
    release_after_service_stop().await?;
    assert!(!status().await.wanted);
    crate::core::selective_layer::remove().await; // The pre-release hold died with the process.

    // A fresh Service has only the persisted disposition; no native hold was installed.
    RECONNECT_AFTER_RELEASE.store(false, Ordering::Release);
    restore_on_service_start().await?;
    let held = crate::core::selective_layer::test_hold_active();
    let wanted = status().await.wanted;
    cleanup().await;
    assert!(held, "automatic AI-hold intent must survive interruption before native installation");
    assert!(!wanted, "replaying a narrow hold must not restore a general block");
    Ok(())
}

#[tokio::test]
#[serial]
async fn idle_stop_preserves_automatic_ai_recovery_across_service_death() -> Result<()> {
    cleanup().await;
    release_applying_narrow().await?;
    release_after_service_stop().await?;
    crate::core::selective_layer::remove().await; // Native hold was lost during replacement.
    restore_on_service_start().await?;
    let held = crate::core::selective_layer::test_hold_active();
    cleanup().await;
    assert!(held, "idle Stop must keep the durable automatic AI disposition");
    Ok(())
}

#[tokio::test]
#[serial]
async fn replacement_preserves_automatic_ai_recovery_disposition() -> Result<()> {
    cleanup().await;
    release_applying_narrow().await?;
    assert!(prepare_for_service_replacement().await?);
    crate::core::selective_layer::remove().await;
    restore_on_service_start().await?;
    let held = crate::core::selective_layer::test_hold_active();
    cleanup().await;
    assert!(held, "Service replacement must retain automatic AI intent");
    Ok(())
}

#[tokio::test]
#[serial]
async fn interrupted_update_emergency_release_replays_the_ai_hold() -> Result<()> {
    cleanup().await;
    TEST_INTERRUPT_RELEASE_FOLLOW_UP.store(true, Ordering::SeqCst);
    emergency_disarm_windows_kill_switch_applying_narrow().await?;
    crate::core::selective_layer::remove().await; // The pre-release hold died with the process.
    restore_on_service_start().await?;
    let held = crate::core::selective_layer::test_hold_active();
    let wanted = status().await.wanted;
    cleanup().await;
    assert!(held, "automatic emergency release must retain the replay record");
    assert!(!wanted, "replay cannot re-arm broad WFP");
    Ok(())
}

#[tokio::test]
#[serial]
async fn interrupted_explicit_restore_cancels_the_durable_ai_hold() -> Result<()> {
    cleanup().await;
    release_applying_narrow().await?;
    TEST_INTERRUPT_RELEASE_FOLLOW_UP.store(true, Ordering::SeqCst);
    release().await?;
    assert!(crate::core::selective_layer::test_hold_active());
    restore_on_service_start().await?;
    let held = crate::core::selective_layer::test_hold_active();
    cleanup().await;
    assert!(!held, "explicit Restore must supersede persisted automatic AI intent");
    Ok(())
}

#[tokio::test]
#[serial]
async fn idle_stop_keeps_corrupt_automatic_recovery_evidence() -> Result<()> {
    cleanup().await;
    atomic_write(&intent_path(), b"corrupt-auto-recovery").await?;
    restore_on_service_start().await?;
    release_after_service_stop().await?;
    let evidence = tokio::fs::read(intent_path()).await?;
    crate::core::selective_layer::remove().await;
    restore_on_service_start().await?;
    let held = crate::core::selective_layer::test_hold_active();
    cleanup().await;
    assert_eq!(evidence, b"corrupt-auto-recovery");
    assert!(held, "corrupt evidence must still request automatic recovery on restart");
    Ok(())
}

#[tokio::test]
#[serial]
async fn legacy_crash_reconnect_tombstone_replays_the_ai_hold() -> Result<()> {
    cleanup().await;
    let mut legacy = serde_json::to_value(crash_recovery_tombstone(None))?;
    legacy.as_object_mut().unwrap().remove("apply_narrow_after_release");
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&legacy)?).await?;
    restore_on_service_start().await?;
    let held = crate::core::selective_layer::test_hold_active();
    let reconnect = status().await.reconnect_after_release;
    cleanup().await;
    assert!(held, "legacy crash reconnect intent still requests the automatic AI hold");
    assert!(reconnect);
    Ok(())
}

#[tokio::test]
#[serial]
async fn crash_window_reconnect_is_reported_only_to_the_released_owner() -> Result<()> {
    cleanup().await;
    let mut intent = valid_intent(KillSwitchStatusMode::Locked, true);
    intent.owner_key = Some("owner-alice".to_owned());
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
    restore_on_service_start().await?;
    assert!(
        !status().await.wanted,
        "no Core and no replay releases Alice's session"
    );

    // Bob's App gets no reconnect, so it never connects on Bob's account and takes over;
    // his read neither consumes nor clears the flag Alice's App is owed.
    let bob = status_for("owner-bob").await.reconnect_after_release;
    let alice = status_for("owner-alice").await.reconnect_after_release;
    let on_disk: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
    cleanup().await;
    assert!(
        !bob,
        "another signed-in user's App must not be told to reconnect"
    );
    assert!(
        alice,
        "the released owner is still told to reconnect after Bob's read"
    );
    assert_eq!(on_disk.reconnect_owner_key.as_deref(), Some("owner-alice"));
    assert_eq!(
        on_disk.owner_key, None,
        "the tombstone itself stays ownerless"
    );
    Ok(())
}

#[tokio::test]
#[serial]
async fn automatic_release_installs_the_ai_hold_before_removing_wfp() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    TEST_HOLD_AT_LAST_REMOVAL.store(false, Ordering::SeqCst);

    release_unhealthy_session_unlocked("test watchdog release").await?;
    let held_at_removal = TEST_HOLD_AT_LAST_REMOVAL.load(Ordering::SeqCst);
    let released = armed_guard().is_none();
    cleanup().await;

    assert!(
        released,
        "a non-strict automatic release must open general traffic"
    );
    assert!(
        held_at_removal,
        "AI must already be held when WFP is removed (#1271)"
    );
    Ok(())
}

#[tokio::test]
#[serial]
async fn near_release_deadline_skips_the_ai_hold_wait_before_removing_wfp() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    TEST_HOLD_AT_LAST_REMOVAL.store(true, Ordering::SeqCst);

    // A StartClash rollback in another task: no Stop scope, only the process-wide deadline.
    note_release_deadline(std::time::Instant::now() + std::time::Duration::from_secs(1));
    release_applying_narrow().await?;
    let held_at_removal = TEST_HOLD_AT_LAST_REMOVAL.load(Ordering::SeqCst);
    let released = armed_guard().is_none();
    let held_after = crate::core::selective_layer::test_hold_active();
    let reported = status().await.last_error;
    cleanup().await;

    assert!(released, "a release racing SCM Stop must still remove WFP");
    assert!(
        !held_at_removal,
        "no AI hold wait may spend the time WFP removal needs"
    );
    assert!(
        held_after,
        "the post-removal follow-up still applies the AI hold"
    );
    assert!(
        reported.is_some_and(|error| error.contains("before releasing general traffic")),
        "the skipped hold must stay visible after the release succeeds"
    );
    Ok(())
}

#[tokio::test]
#[serial]
async fn service_stop_release_keeps_the_ai_hold_for_an_armed_session() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;

    release_after_service_stop().await?;
    let released = !status().await.wanted && armed_guard().is_none();
    let ai_held = crate::core::selective_layer::test_hold_active();
    cleanup().await;

    assert!(released, "ordinary Service stop must release general traffic");
    assert!(ai_held, "automatic Service stop must apply the AI hold");
    Ok(())
}

#[tokio::test]
#[serial]
async fn service_stop_release_does_not_reapply_ai_hold_after_explicit_restore() -> Result<()> {
    cleanup().await;
    crate::core::selective_layer::finish_release(true).await;
    release().await?;

    release_after_service_stop().await?;
    let ai_held = crate::core::selective_layer::test_hold_active();
    cleanup().await;

    assert!(
        !ai_held,
        "idle Stop after explicit Restore must stay unprotected"
    );
    Ok(())
}

#[tokio::test]
#[serial]
async fn service_stop_release_preserves_an_existing_idle_ai_hold() -> Result<()> {
    cleanup().await;
    crate::core::selective_layer::finish_release(true).await;

    release_after_service_stop().await?;
    let ai_held = crate::core::selective_layer::test_hold_active();
    cleanup().await;

    assert!(
        ai_held,
        "idle Stop cannot remove a previous crash recovery hold"
    );
    Ok(())
}

#[tokio::test]
#[serial]
async fn service_stop_release_preserves_an_explicit_strict_intent() -> Result<()> {
    cleanup().await;
    let mut intent = valid_intent(KillSwitchStatusMode::Blocked, true);
    intent.strict_kill_switch = true;
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
    restore_on_service_start().await?;

    release_after_service_stop().await?;
    let wanted = status().await.wanted;
    cleanup().await;

    assert!(
        wanted,
        "automatic Stop cannot retire explicit strict protection"
    );
    Ok(())
}

#[tokio::test]
#[serial]
async fn unverified_startup_intent_releases_with_ai_hold_when_dns_cannot_be_proven()
-> Result<()> {
    cleanup().await;
    let mut intent = valid_intent(KillSwitchStatusMode::Blocked, true);
    intent.verified = Some(false);
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
    simulate_machine_still_on_loopback_dns();
    atomic_write(&dns_snapshot_path(), b"{ corrupt").await?;

    restore_on_service_start().await?;

    assert!(ARMED.lock().unwrap().is_some());
    assert!(status().await.wanted);

    // Decision 031 (#1259): a non-strict machine must not stay Blocked because retirement
    // could not prove DNS. The error still reaches the caller so no desired Core is restored.
    let error = retire_unverified_on_service_start()
        .await
        .expect_err("an unclean retirement is still reported to the caller");
    let released = ARMED.lock().unwrap().is_none() && !status().await.wanted;
    let ai_held = crate::core::selective_layer::test_hold_active();
    let dns_evidence_kept = tokio::fs::metadata(dns_snapshot_path()).await.is_ok();
    let tombstone = assert_disarmed_tombstone_present().await;
    cleanup().await;

    assert!(format!("{error:#}").contains("corrupt"), "{error:#}");
    assert!(
        released,
        "non-strict startup recovery must release general traffic"
    );
    assert!(ai_held, "the release must keep the secondary AI hold");
    assert!(
        dns_evidence_kept,
        "failed DNS evidence must remain available for recovery"
    );
    tombstone
}

#[tokio::test]
#[serial]
async fn unverified_startup_recovery_keeps_ai_hold_after_releasing_general_traffic() -> Result<()> {
    cleanup().await;
    crate::core::desired::clear_active_owner().await?;
    let mut intent = valid_intent(KillSwitchStatusMode::Bootstrap, true);
    intent.verified = Some(false);
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

    restore_on_service_start().await?;
    assert!(retire_unverified_on_service_start().await?);
    let released = !status().await.wanted && armed_guard().is_none();
    let ai_held = crate::core::selective_layer::test_hold_active();
    cleanup().await;

    assert!(
        released,
        "interrupted initial connection must release general traffic"
    );
    assert!(
        ai_held,
        "automatic startup recovery must keep the secondary AI hold"
    );
    Ok(())
}

#[tokio::test]
#[serial]
async fn unverified_startup_recovery_preserves_an_explicit_strict_intent() -> Result<()> {
    cleanup().await;
    let mut intent = valid_intent(KillSwitchStatusMode::Bootstrap, true);
    intent.verified = Some(false);
    intent.strict_kill_switch = true;
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

    restore_on_service_start().await?;
    let retired = retire_unverified_on_service_start().await?;
    let wanted = status().await.wanted;
    cleanup().await;

    assert!(
        !retired,
        "automatic recovery cannot retire an explicit strict intent"
    );
    assert!(wanted, "the strict barrier must remain armed");
    Ok(())
}

#[tokio::test]
#[serial]
async fn verified_startup_intent_is_never_retired_by_initial_attempt_cleanup() -> Result<()> {
    cleanup().await;
    TEST_CORE_STARTING.store(true, Ordering::Relaxed);
    let intent = valid_intent(KillSwitchStatusMode::Locked, true);
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

    restore_on_service_start().await?;

    assert!(!retire_unverified_on_service_start().await?);
    assert!(ARMED.lock().unwrap().is_some());
    assert!(tokio::fs::metadata(intent_path()).await.is_ok());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn legacy_unowned_unverified_cleanup_cannot_resurrect_desired_core() -> Result<()> {
    use crate::core::auth::AuthenticatedOwner;
    use crate::{ClashConfig, CoreConfig, OwnerIdentity};

    cleanup().await;
    crate::core::desired::clear_active_owner().await?;
    let owner = AuthenticatedOwner {
        key: "legacy-unowned-wfp-owner".to_owned(),
        identity: OwnerIdentity::Unix {
            uid: 91_001,
            gid: 20,
        },
        app_data_root: std::env::temp_dir(),
        peer_pid: None,
        peer_session_id: None,
    };
    let config = ClashConfig {
        core_config: CoreConfig {
            core_path: "/tmp/legacy-unowned-core".to_owned(),
            ..Default::default()
        },
        log_config: Default::default(),
    };
    crate::core::desired::persist_owner_core_started(&owner, &config).await?;
    crate::core::desired::persist_active_owner(&owner).await?;

    let mut intent = valid_intent(KillSwitchStatusMode::Blocked, true);
    intent.verified = Some(false);
    intent.owner_key = None;
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
    restore_on_service_start().await?;

    assert!(retire_unverified_on_service_start().await?);
    assert!(crate::core::desired::load_active_owner().await?.is_none());
    assert!(
        !crate::core::desired::load_owner_desired_state(&owner.key)
            .await?
            .core_should_be_running
    );
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn restore_with_unwanted_intent_cleans_residual_state() -> Result<()> {
    cleanup().await;
    let intent = valid_intent(KillSwitchStatusMode::Blocked, false);
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

    restore_on_service_start().await?;

    assert!(ARMED.lock().unwrap().is_none());
    assert!(
        tokio::fs::metadata(intent_path()).await.is_err(),
        "an unwanted intent record must be removed"
    );
    assert!(!status().await.wanted);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn unwanted_startup_removal_failure_retries_until_residual_filters_are_gone() -> Result<()>
{
    cleanup().await;
    let mut intent = valid_intent(KillSwitchStatusMode::Blocked, false);
    intent.endpoints.clear();
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
    let residual = wfp_model::intent_floor()
        .iter()
        .map(|filter| filter.key)
        .collect::<Vec<_>>();
    *TEST_RESIDUAL_FILTER_KEYS.lock().unwrap() = residual.clone();
    let failures = SimulatedStateFailures::arm_removal();

    let error = restore_on_service_start()
        .await
        .expect_err("the initial WFP removal fails");

    assert!(format!("{error:#}").contains("simulated WFP removal failure"));
    assert!(armed_guard().is_none());
    assert!(STARTUP_RELEASE_RETRY_RUNNING.load(Ordering::Acquire));
    assert!(
        status()
            .await
            .last_error
            .unwrap()
            .contains("release pending")
    );
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while TEST_REMOVE_ATTEMPTS.load(Ordering::Relaxed) < 2 {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await?;
    assert_eq!(*TEST_RESIDUAL_FILTER_KEYS.lock().unwrap(), residual);
    assert_disarmed_tombstone_present().await?;
    drop(failures);

    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while STARTUP_RELEASE_RETRY_RUNNING.load(Ordering::Acquire) {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await?;

    assert!(TEST_RESIDUAL_FILTER_KEYS.lock().unwrap().is_empty());
    assert_eq!(
        tokio::fs::metadata(intent_path()).await.unwrap_err().kind(),
        std::io::ErrorKind::NotFound
    );
    assert!(armed_guard().is_none());
    assert!(!TUNNEL_PERMIT_RENDERED.load(Ordering::Relaxed));
    assert!(status().await.last_error.is_none());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn startup_release_retry_preserves_the_crash_reconnect_marker() -> Result<()> {
    cleanup().await;
    let intent = crash_recovery_tombstone(None);
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
    let failures = SimulatedStateFailures::arm_removal();

    restore_on_service_start()
        .await
        .expect_err("the initial WFP removal fails");
    drop(failures);
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while STARTUP_RELEASE_RETRY_RUNNING.load(Ordering::Acquire) {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await?;

    assert!(
        status().await.reconnect_after_release,
        "successful retry must still tell the app to reconnect"
    );
    let persisted: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
    assert!(crate::core::selective_layer::test_hold_active(), "startup retry must replay the durable AI hold");
    assert!(persisted.reconnect_after_release);
    assert!(!persisted.wanted);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn explicit_release_tombstone_survives_until_replacement_start_consumes_it() -> Result<()>
{
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;

    release().await?;
    assert_disarmed_tombstone_present().await?;

    // The in-place replacement is a fresh process; only the on-disk tombstone crosses it.
    *ARMED.lock().unwrap() = None;
    restore_on_service_start().await?;

    assert!(ARMED.lock().unwrap().is_none());
    assert!(
        tokio::fs::metadata(intent_path()).await.is_err(),
        "startup consumes the tombstone only after the residual-filter cleanup"
    );
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn replacement_marks_a_pre_fix_disconnected_install_but_preserves_wanted_intent()
-> Result<()> {
    cleanup().await;

    assert!(prepare_for_service_replacement().await?);
    assert_disarmed_tombstone_present().await?;

    let wanted = valid_intent(KillSwitchStatusMode::Locked, true);
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&wanted)?).await?;
    assert!(
        !prepare_for_service_replacement().await?,
        "a valid wanted session must stay fail-closed across replacement"
    );
    let preserved: IntentRecord =
        serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
    assert!(preserved.wanted);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn replacement_never_synthesizes_an_open_marker_for_an_active_owner() -> Result<()> {
    cleanup().await;
    let active = crate::core::desired::ActiveOwnerState {
        owner_key: "owner-active".to_owned(),
        identity: crate::OwnerIdentity::Windows {
            sid: "S-1-5-21-test-owner".to_owned(),
        },
        app_data_root: std::env::temp_dir().to_string_lossy().into_owned(),
        generation: 7,
        session_token_hash: "session-hash".to_owned(),
    };
    atomic_write(
        &crate::service_paths().active_owner_path(),
        &serde_json::to_vec_pretty(&active)?,
    )
    .await?;

    assert!(!prepare_for_service_replacement().await?);
    assert!(
        tokio::fs::metadata(intent_path()).await.is_err(),
        "an active owner with missing WFP evidence is ambiguous and must not be opened"
    );
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn replacement_preserves_corrupt_active_owner_evidence_fail_closed() -> Result<()> {
    cleanup().await;
    atomic_write(
        &crate::service_paths().active_owner_path(),
        b"{ corrupt active owner evidence",
    )
    .await?;

    assert!(!prepare_for_service_replacement().await?);
    assert!(
        tokio::fs::metadata(intent_path()).await.is_err(),
        "damaged owner evidence is ambiguity, never permission to synthesize wanted=false"
    );
    assert_eq!(
        tokio::fs::read(crate::service_paths().active_owner_path()).await?,
        b"{ corrupt active owner evidence",
        "replacement preparation must retain evidence for diagnosis"
    );
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn replacement_preserves_corrupt_intent_fail_closed() -> Result<()> {
    cleanup().await;
    atomic_write(&intent_path(), b"{ corrupt wanted evidence").await?;

    assert!(!prepare_for_service_replacement().await?);
    assert_eq!(
        tokio::fs::read(intent_path()).await?,
        b"{ corrupt wanted evidence"
    );
    cleanup().await;
    Ok(())
}

/// An unusable wanted record is not an explicit strict opt-in. Startup releases and
/// leaves the file in place.
#[tokio::test]
#[serial]
async fn an_unusable_wanted_intent_releases_unless_strict() -> Result<()> {
    cleanup().await;
    let mut intent = valid_intent(KillSwitchStatusMode::Locked, true);
    intent.endpoints = vec![ProxyEndpoint {
        ip: "not-an-ip".to_owned(),
        port: 443,
        protocol: ProxyProtocol::Tcp,
    }];
    let bytes = serde_json::to_vec_pretty(&intent)?;
    atomic_write(&intent_path(), &bytes).await?;

    restore_on_service_start().await?;

    assert!(armed_guard().is_none());
    assert!(!status().await.wanted);
    assert_eq!(tokio::fs::read(intent_path()).await?, bytes);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn an_unusable_strict_intent_keeps_the_emergency_block() -> Result<()> {
    cleanup().await;
    let mut intent = valid_intent(KillSwitchStatusMode::Locked, true);
    intent.strict_kill_switch = true;
    intent.endpoints = vec![ProxyEndpoint {
        ip: "not-an-ip".to_owned(),
        port: 443,
        protocol: ProxyProtocol::Tcp,
    }];
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

    restore_on_service_start().await?;

    let armed = armed_guard().clone().expect("strict opt-in keeps a block");
    assert!(armed.intent.strict_kill_switch);
    assert!(armed.intent.wanted);
    assert!(armed.intent.endpoints.is_empty());
    assert!(status().await.wanted);
    assert!(tokio::fs::metadata(intent_path()).await.is_ok());
    cleanup().await;
    Ok(())
}

/// S2 in miniature: a DNS restore that never returns must not hold `WFP_OPERATION` — and
/// the refusal must keep the disarm on the fail-closed side, never skip the proof.
#[tokio::test]
#[serial]
async fn a_stalled_dns_restore_is_bounded_and_refuses_the_operation() -> Result<()> {
    let error = bounded_dns_call_within(
        std::time::Duration::from_millis(50),
        "disarm",
        std::future::pending::<Result<()>>(),
    )
    .await
    .expect_err("a DNS restore that never returns must not be awaited forever");
    let message = format!("{error:#}");
    assert!(message.contains(DNS_RESTORE_STALLED_PREFIX), "{message}");
    assert!(message.contains("disarm"), "{message}");

    // A healthy call is transparent in both directions: the bound adds no behavior of its
    // own, so every caller keeps treating a DNS failure exactly as it did before.
    let value = bounded_dns_call_within(std::time::Duration::from_secs(5), "disarm", async {
        Result::<u8>::Ok(7)
    })
    .await?;
    assert_eq!(value, 7);
    let error = bounded_dns_call_within(std::time::Duration::from_secs(5), "disarm", async {
        Result::<()>::Err(anyhow::anyhow!("snapshot is corrupt"))
    })
    .await
    .expect_err("DNS errors still propagate");
    assert!(format!("{error:#}").contains("corrupt"));
    Ok(())
}

#[tokio::test]
#[serial]
async fn explicit_release_supersedes_a_pending_crash_tombstone() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    let failures = SimulatedStateFailures::arm(true, false);
    release_unproven_wanted_session_unlocked().await
        .expect_err("the crash tombstone write fails after WFP is released");
    assert!(CRASH_TOMBSTONE_PENDING.load(Ordering::Acquire));
    drop(failures);

    release().await?;
    assert!(!status().await.reconnect_after_release);
    // The watchdog retries its old failed write after the successful Disconnect.
    retry_crash_tombstone_unlocked().await;
    // A later Service restart must recover the user's Disconnect, not the older crash.
    restore_on_service_start().await?;
    assert!(
        !status().await.reconnect_after_release,
        "a pending crash write must not resurrect reconnect intent after Disconnect"
    );
    assert!(!status().await.wanted);
    assert!(!crate::core::selective_layer::test_hold_active());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn restore_with_corrupt_intent_releases_and_keeps_evidence() -> Result<()> {
    cleanup().await;
    atomic_write(&intent_path(), b"{ not json").await?;

    restore_on_service_start().await?;

    assert!(
        armed_guard().is_none(),
        "corrupt bytes are not an explicit strict opt-in"
    );
    assert!(!status().await.wanted);
    assert_eq!(tokio::fs::read(intent_path()).await?, b"{ not json");
    assert!(
        crate::core::selective_layer::test_hold_active(),
        "crash recovery must retain the narrow AI hold after opening general traffic"
    );
    release().await?;
    assert!(!crate::core::selective_layer::test_hold_active());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn corrupt_startup_removal_failure_retries_and_keeps_evidence_and_ai_hold() -> Result<()>
{
    cleanup().await;
    let evidence = b"{ incomplete intent";
    atomic_write(&intent_path(), evidence).await?;
    let residual = wfp_model::intent_floor()
        .iter()
        .map(|filter| filter.key)
        .collect::<Vec<_>>();
    *TEST_RESIDUAL_FILTER_KEYS.lock().unwrap() = residual.clone();
    let failures = SimulatedStateFailures::arm_removal();

    let error = restore_on_service_start()
        .await
        .expect_err("the initial native removal fails");
    assert!(format!("{error:#}").contains("simulated WFP removal failure"));
    assert!(armed_guard().is_none());
    assert_eq!(*TEST_RESIDUAL_FILTER_KEYS.lock().unwrap(), residual);
    drop(failures);

    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while !TEST_RESIDUAL_FILTER_KEYS.lock().unwrap().is_empty()
            || STARTUP_RELEASE_RETRY_RUNNING.load(Ordering::Acquire)
        {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("recovery must retry after the transient removal error clears");

    assert!(TEST_REMOVE_ATTEMPTS.load(Ordering::Relaxed) >= 2);
    assert_eq!(tokio::fs::read(intent_path()).await?, evidence);
    assert!(crate::core::selective_layer::test_hold_active());
    assert!(!status().await.wanted);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn corrupt_startup_release_retry_preserves_a_new_unusable_strict_record() -> Result<()> {
    cleanup().await;
    atomic_write(&intent_path(), b"{ incomplete intent").await?;
    let residual = wfp_model::intent_floor()
        .iter()
        .map(|filter| filter.key)
        .collect::<Vec<_>>();
    *TEST_RESIDUAL_FILTER_KEYS.lock().unwrap() = residual.clone();
    let failures = SimulatedStateFailures::arm_removal();
    restore_on_service_start()
        .await
        .expect_err("the initial removal fails");

    let operation = WFP_OPERATION.lock().await;
    let mut strict = valid_intent(KillSwitchStatusMode::Blocked, true);
    strict.strict_kill_switch = true;
    strict.endpoints.clear();
    assert!(!intent_is_valid(&strict));
    let strict_bytes = serde_json::to_vec_pretty(&strict)?;
    atomic_write(&intent_path(), &strict_bytes).await?;
    let attempts = TEST_REMOVE_ATTEMPTS.load(Ordering::Relaxed);
    drop(failures);
    drop(operation);

    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while STARTUP_RELEASE_RETRY_RUNNING.load(Ordering::Acquire) {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await?;

    assert_eq!(TEST_REMOVE_ATTEMPTS.load(Ordering::Relaxed), attempts);
    assert_eq!(*TEST_RESIDUAL_FILTER_KEYS.lock().unwrap(), residual);
    assert_eq!(tokio::fs::read(intent_path()).await?, strict_bytes);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn restore_with_unreadable_intent_releases() -> Result<()> {
    cleanup().await;
    // A directory at the intent path makes the read fail with a non-NotFound error on
    // every platform — the stand-in for ACL damage or transient I/O on a real service.
    tokio::fs::create_dir_all(intent_path()).await?;

    restore_on_service_start().await?;

    assert!(armed_guard().is_none());
    assert!(!status().await.wanted);

    tokio::fs::remove_dir(intent_path()).await?;
    cleanup().await;
    Ok(())
}

#[test]
fn service_stop_releases_only_without_strict_or_lifecycle_ownership() {
    assert!(release_on_service_stop(false, false));
    assert!(!release_on_service_stop(true, false));
    assert!(!release_on_service_stop(false, true));
    assert!(!release_on_service_stop(true, true));
}

#[test]
fn unhealthy_watchdog_releases_without_a_strict_opt_in() {
    assert!(crash_recovery_releases_network(false));
    assert_eq!(
        unhealthy_watchdog_action(false, UNHEALTHY_RELEASE_TICKS - 1),
        UnhealthyWatchdogAction::Wait
    );
    assert_eq!(
        unhealthy_watchdog_action(false, UNHEALTHY_RELEASE_TICKS),
        UnhealthyWatchdogAction::Release
    );
}

#[test]
fn strict_kill_switch_repairs_then_releases() {
    assert!(!crash_recovery_releases_network(true));
    assert_eq!(
        unhealthy_watchdog_action(true, 1),
        UnhealthyWatchdogAction::Reinstall
    );
    assert_eq!(
        unhealthy_watchdog_action(true, STRICT_UNHEALTHY_RELEASE_TICKS),
        UnhealthyWatchdogAction::Release
    );
}

#[tokio::test]
#[serial]
async fn restore_with_missing_intent_is_a_noop() -> Result<()> {
    cleanup().await;

    restore_on_service_start().await?;

    assert!(ARMED.lock().unwrap().is_none());
    assert!(!status().await.wanted);
    cleanup().await;
    Ok(())
}

#[test]
fn a_release_supersedes_a_startclash_that_began_before_it() {
    let captured = release_epoch();
    assert!(!release_superseded(captured));
    note_explicit_release();
    assert!(release_superseded(captured));
    let later = release_epoch();
    assert!(!release_superseded(later));
}

#[test]
fn restore_unions_learned_public_pins_after_existing_hosts() {
    let merged = union_api_hosts(
        &["104.20.26.170".to_owned(), "10.0.0.1".to_owned()],
        &[
            "9.9.9.9".to_owned(),
            "198.18.0.2".to_owned(),
            "104.20.26.170".to_owned(),
        ],
    );
    assert_eq!(merged[0], "104.20.26.170");
    assert!(merged.contains(&"9.9.9.9".to_owned()));
    assert!(!merged.iter().any(|ip| ip == "10.0.0.1"));
    assert!(!merged.iter().any(|ip| ip == "198.18.0.2"));
    assert!(merged.len() <= wfp_model::MAX_API_HOST_IPS);
}

#[test]
#[serial]
fn apply_learned_bootstrap_pins_reads_the_programdata_file() {
    let dir = crate::service_paths().install_dir();
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("control-plane-pins.json");
    std::fs::write(
        &path,
        r#"{"host":"api.afk.ccwu.cc","addresses":["9.9.9.9","198.18.0.1"]}"#,
    )
    .expect("write learned pins");
    let mut intent = IntentRecord {
        wanted: true,
        mode: KillSwitchStatusMode::Locked,
        verified: Some(true),
        tunnel_interface: "Tono".to_owned(),
        app_path: r"C:\Program Files\Tono\verge-mihomo.exe".to_owned(),
        endpoints: Vec::new(),
        api_host_ips: vec!["104.20.26.170".to_owned()],
        updated_at: 0,
        owner_key: None,
        strict_kill_switch: false,
        reconnect_after_release: false,
        reconnect_owner_key: None,
        apply_narrow_after_release: None,
    };
    apply_learned_bootstrap_pins(&mut intent);
    let _ = std::fs::remove_file(&path);
    assert_eq!(intent.api_host_ips[0], "104.20.26.170");
    assert!(intent.api_host_ips.contains(&"9.9.9.9".to_owned()));
    assert!(!intent.api_host_ips.iter().any(|ip| ip == "198.18.0.1"));
}

/// The bootstrap channel's destinations are whatever the *client* pinned, never whatever a
/// resolver answered: a hostname is dropped, not looked up, so no DHCP resolver, captive
/// portal or on-path spoofer can nominate a destination this service permits through its
/// own block. Order, dedup, the public-only table and the cap are unchanged.
#[test]
fn api_hosts_admit_public_literals_only_and_never_resolve_a_name() {
    let ips = admit_api_host_ips(&[
        " 1.1.1.1 ".to_owned(),
        "api.example.invalid".to_owned(),
        "localhost".to_owned(),
        String::new(),
        "8.8.8.8".to_owned(),
        "1.1.1.1".to_owned(),
        "10.0.0.1".to_owned(),
        "127.0.0.1".to_owned(),
    ]);
    assert_eq!(
        ips,
        vec![
            "1.1.1.1".parse::<IpAddr>().unwrap(),
            "8.8.8.8".parse::<IpAddr>().unwrap(),
        ]
    );

    // The count cap still bounds what a client can ask for, hostnames or not.
    let many = (0..32)
        .map(|index| format!("8.8.{}.{}", index / 256, index % 256 + 1))
        .collect::<Vec<_>>();
    assert!(admit_api_host_ips(&many).len() <= wfp_model::MAX_API_HOST_IPS);
    assert!(
        admit_api_host_ips(&["api.example.invalid".to_owned()]).is_empty(),
        "a hostname must yield no permit at all"
    );
}

#[tokio::test]
#[serial]
async fn transition_after_stop_without_release_restricts_to_bootstrap() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;

    transition_after_stop(false).await?;

    let armed = ARMED.lock().unwrap().clone().expect("must stay armed");
    assert_eq!(armed.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(armed.tun_luid.is_none());
    let on_disk: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
    assert_eq!(on_disk.mode, KillSwitchStatusMode::Blocked);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn disarm_is_refused_until_dns_restore_is_proven() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    // A corrupt DNS snapshot makes the restore unprovable: the disarm must be refused and
    // the block must stay armed (the macOS DNS-before-disarm invariant).
    simulate_machine_still_on_loopback_dns();
    atomic_write(&dns_snapshot_path(), b"{ corrupt").await?;

    let error = transition_after_stop(true)
        .await
        .expect_err("disarm must be refused while DNS restore is unproven");
    assert!(format!("{error:#}").contains("corrupt"));
    assert!(
        ARMED.lock().unwrap().is_some(),
        "a refused disarm keeps the block armed"
    );
    assert!(tokio::fs::metadata(intent_path()).await.is_ok());

    // With the snapshot gone there is nothing left to restore, so the same release
    // succeeds and tears everything down.
    tokio::fs::remove_file(dns_snapshot_path()).await?;
    transition_after_stop(true).await?;
    assert!(ARMED.lock().unwrap().is_none());
    assert_disarmed_tombstone_present().await?;
    assert!(!status().await.wanted);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn disarm_succeeds_after_a_proven_dns_restore() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    // A valid, empty snapshot restores trivially (the stubbed engine is a no-op).
    let snapshot = crate::core::dns::DnsSnapshot {
        version: 1,
        taken_at: 1,
        adapters: Vec::new(),
    };
    atomic_write(&dns_snapshot_path(), &serde_json::to_vec_pretty(&snapshot)?).await?;

    transition_after_stop(true).await?;

    assert!(ARMED.lock().unwrap().is_none());
    assert!(tokio::fs::metadata(dns_snapshot_path()).await.is_err());
    assert_disarmed_tombstone_present().await?;
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn failed_update_emergency_release_keeps_the_secondary_ai_hold() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    simulate_machine_still_on_loopback_dns();
    atomic_write(&dns_snapshot_path(), b"{ corrupt").await?;

    let error = emergency_disarm_windows_kill_switch_applying_narrow()
        .await
        .expect_err("DNS restore failure must still be reported after WFP removal");
    assert!(
        format!("{error:#}").contains(crate::core::dns::WFP_REMOVED_CONTINUE_PREFIX)
    );
    assert!(!status().await.wanted);
    assert!(
        crate::core::selective_layer::test_hold_active(),
        "automatic update failure must retain the narrow AI hold after opening general traffic"
    );

    emergency_disarm_windows_kill_switch().await.unwrap_err();
    assert!(!crate::core::selective_layer::test_hold_active());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn emergency_disarm_removes_wfp_intent_but_reports_unrestored_dns() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    simulate_machine_still_on_loopback_dns();
    atomic_write(&dns_snapshot_path(), b"{ corrupt").await?;

    let error = emergency_disarm_windows_kill_switch()
        .await
        .expect_err("unproven DNS restore must fail the uninstall contract");

    let message = format!("{error:#}");
    assert!(message.contains("WFP was removed"), "{message}");
    assert!(message.contains("protected-dns.json"), "{message}");
    assert!(
        message.contains(crate::core::dns::WFP_REMOVED_CONTINUE_PREFIX),
        "post-WFP DNS failure must be tagged so uninstall cannot brick as result 3: {message}"
    );
    assert!(ARMED.lock().unwrap().is_none());
    assert!(
        tokio::fs::metadata(intent_path()).await.is_err(),
        "removed WFP must not be re-armed from a stale intent on reboot"
    );
    assert!(
        tokio::fs::metadata(dns_snapshot_path()).await.is_ok(),
        "failed DNS proof must remain available for retry"
    );
    assert!(
        !message.contains(crate::core::dns::DNS_RESTORED_AUTOMATIC_PREFIX),
        "without the uninstaller's opt-in the DNS ladder must not run — the Start-Menu \
             \"Restore Network\" entry exists to put the user's own servers back on a machine \
             that is staying installed, and must not silently flatten them to DHCP: {message}"
    );
    cleanup().await;
    Ok(())
}

// --- The uninstall-only escalation ladder ---

/// Opts the *process* into `dns::restore_for_uninstall`, exactly as `uninstall_service.rs`
/// does, and takes it back out again so no other test inherits it.
struct UninstallLadderOptIn;

impl UninstallLadderOptIn {
    fn enter() -> Self {
        // SAFETY: every test that uses this is `#[serial]`, so no other thread in this
        // binary is reading or writing the environment while it is set.
        unsafe { std::env::set_var(UNINSTALL_LADDER_ENV, "1") };
        Self
    }
}

impl Drop for UninstallLadderOptIn {
    fn drop(&mut self) {
        // SAFETY: as above.
        unsafe { std::env::remove_var(UNINSTALL_LADDER_ENV) };
    }
}

/// A snapshot whose originals are ordinary public resolvers, so every adapter in it is one
/// Tono redirected and is therefore a legitimate target for the DHCP reset.
fn redirected_snapshot() -> crate::core::dns::DnsSnapshot {
    crate::core::dns::DnsSnapshot {
        version: 1,
        taken_at: 1,
        adapters: vec![
            crate::core::dns::AdapterDnsSnapshot {
                interface_guid: "{ETHERNET}".to_owned(),
                ipv4_name_server: Some("1.1.1.1".to_owned()),
                ..Default::default()
            },
            crate::core::dns::AdapterDnsSnapshot {
                interface_guid: "{WIFI}".to_owned(),
                ipv4_name_server: Some("8.8.8.8".to_owned()),
                ..Default::default()
            },
        ],
    }
}

/// Whether the ladder set the live snapshot aside under its `superseded` name instead of
/// deleting the user's only record of their original resolvers.
async fn superseded_snapshot_exists() -> bool {
    let paths = crate::service_paths();
    let directory = paths.persistent_state_dir();
    let Ok(mut entries) = tokio::fs::read_dir(&directory).await else {
        return false;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("protected-dns.superseded-") {
            return true;
        }
    }
    false
}

async fn remove_superseded_snapshots() {
    let paths = crate::service_paths();
    let directory = paths.persistent_state_dir();
    let Ok(mut entries) = tokio::fs::read_dir(&directory).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("protected-dns.superseded-") {
            let _ = tokio::fs::remove_file(entry.path()).await;
        }
    }
}

/// Rung 1: nothing changes for a machine whose exact restore is provable. The ladder is an
/// escalation, not a shortcut — it must never reach for DHCP while the saved servers can be
/// put back.
#[tokio::test]
#[serial]
async fn uninstall_ladder_prefers_the_exact_restore() -> Result<()> {
    cleanup().await;
    remove_superseded_snapshots().await;
    let _opt_in = UninstallLadderOptIn::enter();
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    atomic_write(
        &dns_snapshot_path(),
        &serde_json::to_vec_pretty(&crate::core::dns::DnsSnapshot {
            version: 1,
            taken_at: 1,
            adapters: Vec::new(),
        })?,
    )
    .await?;

    emergency_disarm_windows_kill_switch()
        .await
        .expect("a provable restore reports plain success");

    assert!(ARMED.lock().unwrap().is_none());
    assert!(tokio::fs::metadata(dns_snapshot_path()).await.is_err());
    assert!(
        !superseded_snapshot_exists().await,
        "rung 1 must not leave a superseded snapshot behind"
    );
    cleanup().await;
    Ok(())
}

/// Rung 2 — the regression this ladder exists for. The machine is still resolving through
/// the loopback core when the exact restore is attempted, so the old code returned an
/// unqualified failure, `uninstall_service.rs` exited 3 and `installer.nsi` aborted: the
/// application could not be uninstalled at all. Now the adapters are reset to automatic
/// (DHCP), verified off the loopback resolver, and the failure carries the marker that lets
/// the uninstall continue.
#[tokio::test]
#[serial]
async fn uninstall_ladder_falls_back_to_automatic_dns_instead_of_becoming_unremovable()
-> Result<()> {
    cleanup().await;
    remove_superseded_snapshots().await;
    let _opt_in = UninstallLadderOptIn::enter();
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    atomic_write(
        &dns_snapshot_path(),
        &serde_json::to_vec_pretty(&redirected_snapshot())?,
    )
    .await?;
    // The reported machine: the exact restore cannot be proven because adapters still read
    // as the loopback redirect. The DHCP reset is what clears that.
    simulate_machine_still_on_loopback_dns();

    let error = emergency_disarm_windows_kill_switch()
        .await
        .expect_err("an inexact restore is still reported, but as a continuable one");
    let message = format!("{error:#}");

    assert!(
        message.contains(crate::core::dns::DNS_RESTORED_AUTOMATIC_PREFIX),
        "the fallback must be reported with the marker the uninstaller keys its \
             continue-with-warning exit code off: {message}"
    );
    assert!(
        !message.contains(crate::core::dns::DNS_UNINSTALL_STILL_ON_LOOPBACK_PREFIX),
        "{message}"
    );
    // The invariant: the marker may only ever be produced once the barrier is gone.
    assert!(
        ARMED.lock().unwrap().is_none(),
        "the continuing outcome must never be reported while the kill switch is armed"
    );
    assert!(
        tokio::fs::metadata(intent_path()).await.is_err(),
        "a continuing uninstall must not leave an intent record that re-arms on reboot"
    );
    assert!(
        tokio::fs::metadata(dns_snapshot_path()).await.is_err(),
        "the redirect is gone, so the live snapshot must not survive to be replayed"
    );
    assert!(
        superseded_snapshot_exists().await,
        "the user's original servers must be retained under the superseded name, not deleted"
    );

    remove_superseded_snapshots().await;
    cleanup().await;
    Ok(())
}

/// Rung 3: DNS may still be stuck on Tono's resolver, but WFP is already gone. The error is
/// still reported (so the detail log can tell the user to flip DNS to Automatic), and it is
/// tagged with the continue marker so install/uninstall never dead-end as result 3.
#[tokio::test]
#[serial]
async fn uninstall_ladder_reports_stuck_dns_but_lets_uninstall_continue_after_wfp_is_gone()
-> Result<()> {
    cleanup().await;
    remove_superseded_snapshots().await;
    let _opt_in = UninstallLadderOptIn::enter();
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    atomic_write(
        &dns_snapshot_path(),
        &serde_json::to_vec_pretty(&redirected_snapshot())?,
    )
    .await?;
    simulate_machine_still_on_loopback_dns();
    // Neither the exact restore nor the DHCP reset lands, so nothing takes the machine off
    // the loopback resolver.
    crate::core::dns::test_hooks::set_live_apply_fails(true);

    let error = emergency_disarm_windows_kill_switch()
        .await
        .expect_err("stuck DNS is still reported, but as a continuable outcome");
    let message = format!("{error:#}");

    assert!(
        message.contains(crate::core::dns::DNS_UNINSTALL_STILL_ON_LOOPBACK_PREFIX),
        "{message}"
    );
    assert!(
        message.contains(crate::core::dns::WFP_REMOVED_CONTINUE_PREFIX),
        "post-WFP DNS failure must carry the continue marker so result 3 cannot fire: \
             {message}"
    );
    assert!(
        message.contains("Automatic (DHCP)"),
        "the report has to tell the user what to do about DNS: {message}"
    );
    // The barrier is removed: being unable to remove the app *and* being blocked offline is
    // the worse end state, and the barrier is the half that makes them offline.
    assert!(ARMED.lock().unwrap().is_none());
    assert!(tokio::fs::metadata(intent_path()).await.is_err());
    assert!(
        tokio::fs::metadata(dns_snapshot_path()).await.is_ok(),
        "imperfect DNS restore preserves the snapshot so the user can recover originals"
    );
    assert!(!superseded_snapshot_exists().await);

    crate::core::dns::test_hooks::set_live_apply_fails(false);
    remove_superseded_snapshots().await;
    cleanup().await;
    Ok(())
}

/// BRICK-W4: once WFP was gone every DNS outcome carried `TONO_WFP_REMOVED`, so the
/// uninstall finished while Tono's NRPT catch-all still sent every lookup to 198.18.0.2. A
/// rule that cannot be removed has its own marker now, and that marker blocks.
#[tokio::test]
#[serial]
async fn emergency_disarm_blocks_uninstall_while_the_nrpt_rule_remains() -> Result<()> {
    cleanup().await;
    remove_superseded_snapshots().await;
    let _opt_in = UninstallLadderOptIn::enter();
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    atomic_write(
        &dns_snapshot_path(),
        &serde_json::to_vec_pretty(&redirected_snapshot())?,
    )
    .await?;
    crate::core::dns::test_hooks::set_encrypted_restore_fails(true);

    let result = emergency_disarm_windows_kill_switch().await;
    crate::core::dns::test_hooks::set_encrypted_restore_fails(false);
    let message = format!(
        "{:#}",
        result.expect_err("a remaining NRPT rule must not read as a finished disarm")
    );

    assert!(message.starts_with("TONO_DNS_POLICY_REMAINS"), "{message}");
    assert!(
        message.contains(crate::core::dns::WFP_REMOVED_CONTINUE_PREFIX),
        "the DNS outcome follows the blocking marker, for the helper's final call: {message}"
    );
    assert!(ARMED.lock().unwrap().is_none(), "the barrier is removed");
    remove_superseded_snapshots().await;
    cleanup().await;
    Ok(())
}

/// The opt-in is the whole boundary between the two behaviours: an unset or unrecognised
/// value must leave the strict path in force, because everything that is not an uninstall
/// still wants the user's exact servers back.
#[test]
#[serial]
fn only_an_explicit_opt_in_enables_the_uninstall_ladder() {
    // SAFETY: `#[serial]` peers; this test touches the variable alone.
    unsafe { std::env::remove_var(UNINSTALL_LADDER_ENV) };
    assert!(!uninstall_ladder_requested());
    for value in ["", "0", "true", "yes", "2"] {
        unsafe { std::env::set_var(UNINSTALL_LADDER_ENV, value) };
        assert!(
            !uninstall_ladder_requested(),
            "{value:?} must not be read as an opt-in"
        );
    }
    unsafe { std::env::set_var(UNINSTALL_LADDER_ENV, "1") };
    assert!(uninstall_ladder_requested());
    unsafe { std::env::remove_var(UNINSTALL_LADDER_ENV) };
}

#[tokio::test]
#[serial]
async fn release_when_armed_disarms_and_reports_status() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    assert!(status().await.wanted);

    let status = release().await?;

    assert!(!status.wanted, "released status reports wanted=false");
    assert!(ARMED.lock().unwrap().is_none());
    assert_disarmed_tombstone_present().await?;
    cleanup().await;
    Ok(())
}

/// WIN-TOMBSTONE-REBLOCK: the tombstone write failing after the filters are proven gone
/// must not walk the release back. Reinstalling the previous policy re-blocked the machine
/// on every Disconnect for as long as the write kept failing (ACL damage, an AV lock); the
/// release now stands, no wanted intent survives, and the residual is surfaced through
/// `last_error` instead.
#[tokio::test]
#[serial]
async fn a_failed_tombstone_write_after_removal_stays_released() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    // Every persistent write fails from here on (the arm above already committed).
    let failures = SimulatedStateFailures::arm(true, false);

    let status = release().await?;

    assert!(!status.wanted, "the release is final once the filters are gone");
    assert!(ARMED.lock().unwrap().is_none());
    assert_eq!(
        TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed),
        0,
        "the previous policy must not be reinstalled over a failed tombstone write"
    );
    assert!(
        tokio::fs::metadata(intent_path()).await.is_err(),
        "no wanted intent may survive a failed tombstone write"
    );
    let last_error = status
        .last_error
        .expect("the failed release recording must be reported");
    assert!(
        last_error.contains("recording the release failed"),
        "unexpected last_error: {last_error}"
    );

    drop(failures);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn release_when_not_armed_is_an_idempotent_success() -> Result<()> {
    cleanup().await;

    // The whole point of the route: after a stop the session is gone and possibly the
    // switch was never armed — the explicit release must still succeed.
    let status = release().await?;
    assert!(!status.wanted);
    assert_disarmed_tombstone_present().await?;
    let again = release().await?;
    assert!(!again.wanted);
    assert_disarmed_tombstone_present().await?;
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn release_when_not_armed_still_attempts_dns_restore_best_effort() -> Result<()> {
    cleanup().await;
    // Nothing armed, but a previous emergency left a corrupt DNS snapshot behind: the
    // release succeeds (the filters are already gone, refusing buys nothing) and the
    // failed restore is surfaced through last_error.
    simulate_machine_still_on_loopback_dns();
    atomic_write(&dns_snapshot_path(), b"{ corrupt").await?;

    let status = release().await?;

    assert!(!status.wanted);
    let last_error = status
        .last_error
        .expect("an unrestorable snapshot must be reported");
    assert!(
        last_error.contains("could not be restored"),
        "unexpected last_error: {last_error}"
    );
    cleanup().await;
    Ok(())
}

/// H2-F2: a start by a different local user must not rewrite the recorded owner of armed
/// protection while that user is still signed in; otherwise the takeover makes the refused
/// release pass.
#[tokio::test]
#[serial]
async fn another_signed_in_user_cannot_take_over_armed_protection() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;

    let error = arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-bob")
        .await
        .expect_err("a second signed-in user must not take over armed protection");

    assert_eq!(
        error
            .downcast_ref::<crate::core::auth::ServiceError>()
            .map(|refusal| refusal.code),
        Some(crate::ServiceErrorCode::ProtectionHeldByAnotherUser)
    );
    let on_disk: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
    assert_eq!(on_disk.owner_key.as_deref(), Some("owner-alice"));
    cleanup().await;
    Ok(())
}

/// TW-anthropic-1: a first connect from a Remote Desktop (or unreadable) session would arm a
/// block that cuts that session and cannot be released remotely, so it is refused. The
/// console may connect, and only the caller's own *verified* protection keeps its reconnect
/// path: an intent left by a failed first install proves no barrier was ever committed.
#[test]
fn a_remote_session_cannot_be_the_first_to_arm_protection() {
    use CallerSession::{Console, Remote, Unknown};
    fn refused(session: CallerSession, armed: Option<&IntentRecord>) -> bool {
        remote_session_connect_refused(session, armed, "owner-alice")
    }
    let owned = |verified: bool, owner: &str| IntentRecord {
        verified: Some(verified),
        owner_key: Some(owner.to_owned()),
        ..valid_intent(KillSwitchStatusMode::Bootstrap, true)
    };
    let verified = owned(true, "owner-alice");
    let intent_only = owned(false, "owner-alice");
    let other_users = owned(true, "owner-bob");

    assert!(!refused(Console, None));
    assert!(refused(Remote, None));
    assert!(refused(Unknown, None));

    assert!(!refused(Console, Some(&verified)));
    assert!(!refused(Remote, Some(&verified)));
    assert!(!refused(Unknown, Some(&verified)));

    assert!(!refused(Console, Some(&intent_only)));
    assert!(refused(Remote, Some(&intent_only)));
    assert!(refused(Unknown, Some(&intent_only)));

    assert!(refused(Remote, Some(&other_users)));
}

/// TW-R-boot: startup restore keeps a verified intent published (fail-closed, the watchdog
/// retries) even when this start could not install its filters. That carried-over flag then
/// proves no live barrier, so the owner's Remote Desktop exception waits for an install that
/// succeeds.
#[tokio::test]
#[serial]
async fn a_failed_startup_install_withholds_the_remote_reconnect_exception() -> Result<()> {
    cleanup().await;
    TEST_CORE_STARTING.store(true, Ordering::Relaxed);
    let intent = IntentRecord {
        owner_key: Some("owner-alice".to_owned()),
        ..valid_intent(KillSwitchStatusMode::Locked, true)
    };
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

    let failures = SimulatedStateFailures::arm(false, true);
    restore_on_service_start()
        .await
        .expect_err("the failed startup install must be reported");
    let restored = armed_guard().clone().expect("startup stays fail-closed");
    assert!(restored.intent.is_verified());
    assert!(
        connect_session_refused(CallerSession::Remote, "owner-alice"),
        "a verified intent whose filters this start never installed must not admit a remote connect"
    );

    drop(failures);
    // The watchdog's repair installs the same published snapshot.
    install_unlocked(&restored).await?;
    assert!(!connect_session_refused(
        CallerSession::Remote,
        "owner-alice"
    ));
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn write_authorization_follows_the_recorded_owner() -> Result<()> {
    cleanup().await;
    // Nothing armed: any authenticated owner may release (it is a no-op).
    authorize_write_for("owner-alice")?;

    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    authorize_write_for("owner-alice")?;
    let error = authorize_write_for("owner-bob")
        .expect_err("another local user must not release somebody else's protection");
    assert_eq!(error.code, crate::ServiceErrorCode::NotActive);
    // The intent file itself carries the owner key.
    let on_disk: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
    assert_eq!(on_disk.owner_key.as_deref(), Some("owner-alice"));

    // A legacy/emergency intent without owner_key releases for any authenticated owner.
    *ARMED.lock().unwrap() = Some(Armed {
        intent: valid_intent(KillSwitchStatusMode::Blocked, true),
        tun_luid: None,
        core_instance: None,
        direct_endpoints: Vec::new(),
        reviewed_direct_ports: Vec::new(),
        direct_reload: None,
    });
    authorize_write_for("owner-bob")?;
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn lock_rejects_an_interface_that_was_not_recorded_at_arm_time() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;

    let error = lock(Some("Ethernet"))
        .await
        .expect_err("locking a physical adapter must be refused");
    assert!(format!("{error:#}").contains("does not match"));
    // Zero side effects: still bootstrap, no LUID recorded.
    let armed = ARMED.lock().unwrap().clone().expect("still armed");
    assert_eq!(armed.intent.mode, KillSwitchStatusMode::Bootstrap);
    assert!(armed.tun_luid.is_none());

    crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
        .await;
    lock(Some("Tono")).await?;
    let armed = ARMED.lock().unwrap().clone().expect("still armed");
    assert_eq!(armed.intent.mode, KillSwitchStatusMode::Locked);
    assert_eq!(armed.tun_luid, Some(0));
    cleanup().await;
    Ok(())
}

/// A panic while `ARMED` is held poisons the mutex. The next tunnel lock must recover the
/// guard and still install the permit; `ARMED.lock().unwrap()` would panic the IPC task
/// and leave the session unable to lock until the Service process restarts.
#[tokio::test]
#[serial]
async fn lock_recovers_a_poisoned_armed_lock() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
        .await;

    struct ClearPoison;
    impl Drop for ClearPoison {
        fn drop(&mut self) {
            ARMED.clear_poison();
        }
    }
    let poison = ClearPoison;
    assert!(
        std::thread::spawn(|| {
            let _armed = ARMED.lock().unwrap();
            panic!("simulate a panic while holding ARMED");
        })
        .join()
        .is_err()
    );
    assert!(ARMED.is_poisoned());

    lock(Some("Tono")).await?;

    let armed = armed_guard()
        .clone()
        .expect("lock must proceed on a poisoned ARMED mutex");
    assert_eq!(armed.intent.mode, KillSwitchStatusMode::Locked);
    assert_eq!(armed.tun_luid, Some(0));
    assert_eq!(
        armed.core_instance,
        Some(CoreInstance {
            pid: 4242,
            generation: 1,
        })
    );
    drop(poison);
    cleanup().await;
    Ok(())
}

/// The tunnel permit is the widest rule this service installs: weight 8, `LocalInterface`
/// only — no protocol, port, or app condition. WFP does not notice when the adapter behind
/// that LUID dies, and `NetLuidIndex` is reused, so a permit that outlives the core it was
/// granted for can end up naming whatever device receives that index next. It therefore
/// expires with that core instance, and expiring must fail closed.
#[test]
fn a_tunnel_permit_expires_with_the_core_instance_it_was_granted_for() {
    let granted = CoreInstance {
        pid: 4242,
        generation: 0,
    };
    let mut armed = Armed {
        intent: valid_intent(KillSwitchStatusMode::Locked, true),
        tun_luid: Some(0x1234_5678),
        core_instance: Some(granted),
        direct_endpoints: vec![ProxyEndpoint {
            ip: "203.0.113.9".to_owned(),
            port: 443,
            protocol: ProxyProtocol::Tcp,
        }],
        reviewed_direct_ports: Vec::new(),
        direct_reload: None,
    };

    assert_eq!(
        rule_config_for(&armed, Some(granted)).tun_luid,
        Some(0x1234_5678),
        "the core that locked is still running"
    );

    for (label, current) in [
        (
            "watchdog respawn onto a recycled pid",
            Some(CoreInstance {
                pid: 4242,
                generation: 1,
            }),
        ),
        (
            "watchdog respawn onto a new pid",
            Some(CoreInstance {
                pid: 5150,
                generation: 1,
            }),
        ),
        (
            "the core was replaced without the watchdog",
            Some(CoreInstance {
                pid: 5150,
                generation: 0,
            }),
        ),
        ("no core at all", None),
    ] {
        let config = rule_config_for(&armed, current);
        assert_eq!(config.tun_luid, None, "{label}");
        assert!(
            config.direct_endpoints.is_empty(),
            "{label}: DIRECT must expire with tunnel ownership"
        );
        // Closed, not open: the fallback is exactly the pre-lock policy. The mode, the
        // app-scoped endpoint permit and the DNS block are untouched — only the tunnel
        // permit is gone — so losing the grant widens nothing.
        assert_eq!(config.mode, KillSwitchStatusMode::Locked, "{label}");
        let filters = wfp_model::expected_filters(&config);
        assert!(
            !filters
                .iter()
                .flat_map(|filter| filter.conditions.iter())
                .any(|condition| matches!(condition, wfp_model::Condition::LocalInterface(_))),
            "{label}: a stale LUID must not stay installed"
        );
        assert!(
            filters
                .iter()
                .any(|filter| filter.conditions.contains(&wfp_model::Condition::AleAppId)),
            "{label}: the rest of the locked policy still stands"
        );
    }

    // An unidentified grant is never revived by a tick that also cannot identify a core.
    armed.core_instance = None;
    let config = rule_config_for(&armed, None);
    assert_eq!(config.tun_luid, None);
    assert!(config.direct_endpoints.is_empty());
}

#[test]
fn direct_endpoint_canonicalization_deduplicates_and_has_order_independent_digest() {
    let armed = Armed {
        intent: valid_intent(KillSwitchStatusMode::Locked, true),
        tun_luid: Some(7),
        core_instance: Some(CoreInstance {
            pid: 1,
            generation: 0,
        }),
        direct_endpoints: Vec::new(),
        reviewed_direct_ports: Vec::new(),
        direct_reload: None,
    };
    let a = ProxyEndpoint {
        ip: "9.0.0.9".into(),
        port: 443,
        protocol: ProxyProtocol::Tcp,
    };
    let b = ProxyEndpoint {
        ip: "9.0.0.10".into(),
        port: 8000,
        protocol: ProxyProtocol::Udp,
    };
    let first = canonical_direct_endpoints(&armed, &[a.clone(), b.clone(), a.clone()]).unwrap();
    let second = canonical_direct_endpoints(&armed, &[b, a]).unwrap();
    assert_eq!(first, second);
    assert_eq!(first.len(), 2);
    assert_eq!(
        crate::direct_endpoint_digest(&first).unwrap(),
        crate::direct_endpoint_digest(&second).unwrap()
    );
    assert_eq!(crate::direct_endpoint_digest(&first).unwrap().len(), 64);
}

#[test]
fn direct_public_gate_rejects_special_use_and_accepts_public_unicast() {
    for blocked in [
        Ipv4Addr::new(0, 0, 0, 0),
        Ipv4Addr::new(10, 1, 2, 3),
        Ipv4Addr::new(100, 64, 0, 1),
        Ipv4Addr::LOCALHOST,
        Ipv4Addr::new(169, 254, 1, 1),
        Ipv4Addr::new(172, 31, 1, 1),
        Ipv4Addr::new(192, 168, 1, 1),
        Ipv4Addr::new(198, 18, 0, 1),
        Ipv4Addr::new(203, 0, 113, 9),
        Ipv4Addr::new(224, 0, 0, 1),
        Ipv4Addr::BROADCAST,
    ] {
        assert!(!is_public_direct_ipv4(blocked), "accepted {blocked}");
    }
    for public in [Ipv4Addr::new(9, 0, 0, 9), Ipv4Addr::new(101, 32, 0, 1)] {
        assert!(is_public_direct_ipv4(public), "rejected {public}");
    }
}

async fn locked_direct_test_session() -> Result<CoreInstance> {
    let core = CoreInstance {
        pid: 4242,
        generation: 7,
    };
    crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((
        core.pid,
        core.generation,
    )))
    .await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    lock(None).await?;
    Ok(core)
}

async fn committed_direct_test_session(
    owner_generation: u64,
) -> Result<(CoreInstance, String)> {
    let core = locked_direct_test_session().await?;
    let begin = begin_direct_runtime_reload(owner_generation).await?;
    lock(None).await?;
    let endpoints = test_config_with_direct().direct_endpoints;
    let digest = crate::direct_endpoint_digest(&endpoints).map_err(anyhow::Error::msg)?;
    replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, owner_generation, begin.reload_id).await?;
    finalize_direct_runtime_reload(&digest, owner_generation, begin.reload_id).await?;
    Ok((core, digest))
}

#[tokio::test]
#[serial]
async fn a_proven_same_core_relock_retains_committed_direct() -> Result<()> {
    cleanup().await;
    let (_, digest) = committed_direct_test_session(70).await?;

    lock(None).await?;

    let armed = armed_guard().clone().expect("still locked");
    assert_eq!(armed.intent.mode, KillSwitchStatusMode::Locked);
    assert_eq!(
        crate::direct_endpoint_digest(&armed.direct_endpoints).map_err(anyhow::Error::msg)?,
        digest
    );
    assert_eq!(
        armed.direct_reload.as_ref().map(|lease| lease.phase),
        Some(DirectReloadPhase::Committed)
    );
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn lock_validation_failure_retracts_committed_direct() -> Result<()> {
    cleanup().await;
    committed_direct_test_session(71).await?;

    let error = lock(Some("Ethernet"))
        .await
        .expect_err("a physical interface name must never be accepted as the tunnel");
    assert!(format!("{error:#}").contains("does not match"), "{error:#}");
    let blocked = armed_guard()
        .clone()
        .expect("fail-closed state remains armed");
    assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(blocked.direct_endpoints.is_empty());
    assert!(blocked.direct_reload.is_none());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn lock_without_current_core_retracts_committed_direct() -> Result<()> {
    cleanup().await;
    committed_direct_test_session(72).await?;
    crate::core::manager::set_running_core_identity_for_kill_switch_tests(None).await;

    let error = lock(None)
        .await
        .expect_err("a vanished Core cannot retain or receive DIRECT permits");
    assert!(format!("{error:#}").contains("running core"), "{error:#}");
    let blocked = armed_guard()
        .clone()
        .expect("fail-closed state remains armed");
    assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(blocked.direct_endpoints.is_empty());
    assert!(blocked.direct_reload.is_none());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn lock_persist_failure_narrows_live_direct_before_returning() -> Result<()> {
    cleanup().await;
    committed_direct_test_session(73).await?;

    let failures = SimulatedStateFailures::arm(true, false);
    let error = lock(None)
        .await
        .expect_err("a failed locked-intent write must still remove physical permits");
    let message = format!("{error:#}");
    assert!(message.contains("could not be persisted"), "{message}");
    assert!(message.contains("live WFP was narrowed"), "{message}");
    assert_eq!(
        TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed),
        2,
        "the candidate install must be followed by an exact Blocked install"
    );
    let blocked = armed_guard()
        .clone()
        .expect("live Blocked state is published");
    assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(blocked.direct_endpoints.is_empty());
    assert!(blocked.direct_reload.is_none());

    drop(failures);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn lock_install_failure_keeps_possible_direct_published_and_poisoned() -> Result<()> {
    cleanup().await;
    let (core, digest) = committed_direct_test_session(74).await?;

    let failures = SimulatedStateFailures::arm(false, true);
    let error = lock(None)
        .await
        .expect_err("an unavailable WFP engine cannot prove a narrowing");
    assert!(
        format!("{error:#}").contains("WFP install failure"),
        "{error:#}"
    );
    let retry = armed_guard()
        .clone()
        .expect("the possibly-live set must remain visible for retry");
    assert_eq!(retry.intent.mode, KillSwitchStatusMode::Locked);
    assert_eq!(
        crate::direct_endpoint_digest(&retry.direct_endpoints).map_err(anyhow::Error::msg)?,
        digest
    );
    assert!(
        retry
            .direct_reload
            .as_ref()
            .and_then(|lease| lease.expires_at)
            .is_some_and(|deadline| deadline <= std::time::Instant::now()),
        "a retained endpoint receipt must force watchdog retraction, never renewal"
    );

    drop(failures);
    transition_direct_to_blocked_unlocked(retry, Some(core), None).await?;
    assert!(armed_guard().as_ref().unwrap().direct_endpoints.is_empty());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn core_replacement_barrier_revokes_identity_and_always_revalidates_armed_wfp()
-> Result<()> {
    cleanup().await;
    committed_direct_test_session(75).await?;
    TEST_INSTALL_ATTEMPTS.store(0, Ordering::Relaxed);

    retract_direct_before_core_replacement().await?;

    assert_eq!(TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed), 1);
    let blocked = armed_guard()
        .clone()
        .expect("replacement remains protected");
    assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(blocked.direct_endpoints.is_empty());
    assert!(blocked.direct_reload.is_none());
    assert!(
        crate::core::manager::security_core_instance_snapshot().is_none(),
        "packed Core identity must be revoked inside the WFP writer barrier"
    );

    TEST_INSTALL_ATTEMPTS.store(0, Ordering::Relaxed);
    retract_direct_before_core_replacement().await?;
    assert_eq!(
        TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed),
        1,
        "empty memory is not proof after a Service restart; ARMED must overwrite live WFP"
    );
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn core_replacement_barrier_accepts_only_persist_failure_after_live_blocked() -> Result<()>
{
    cleanup().await;
    committed_direct_test_session(78).await?;
    let failures = SimulatedStateFailures::arm(true, false);

    retract_direct_before_core_replacement().await?;

    assert_eq!(TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed), 1);
    assert_eq!(TEST_PERSIST_ATTEMPTS.load(Ordering::Relaxed), 1);
    let blocked = armed_guard().clone().expect("live Blocked remains published");
    assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(blocked.direct_endpoints.is_empty());
    assert!(blocked.direct_reload.is_none());
    assert!(blocked.tun_luid.is_none());
    assert!(blocked.core_instance.is_none());
    assert!(crate::core::manager::security_core_instance_snapshot().is_none());
    assert!(
        status()
            .await
            .last_error
            .expect("persistence error remains visible")
            .contains("simulated persistent-state write failure")
    );
    drop(failures);

    // A previously Blocked record is not proof that a new live installation succeeded.
    let failures = SimulatedStateFailures::arm(false, true);
    let error = retract_direct_before_core_replacement()
        .await
        .expect_err("live WFP failure must still refuse Core replacement");
    assert!(format!("{error:#}").contains("simulated WFP install failure"));
    drop(failures);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn ambiguous_first_direct_install_publishes_candidate_for_retry() -> Result<()> {
    cleanup().await;
    let core = locked_direct_test_session().await?;
    let begin = begin_direct_runtime_reload(76).await?;
    lock(None).await?;
    let endpoints = test_config_with_direct().direct_endpoints;
    let digest = crate::direct_endpoint_digest(&endpoints).map_err(anyhow::Error::msg)?;

    let failures = SimulatedStateFailures::arm_ambiguous_install();
    let error = replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 76, begin.reload_id)
        .await
        .expect_err("commit-before-verify must be treated as a possibly-live candidate");
    assert!(
        format!("{error:#}").contains("ambiguous WFP install failure"),
        "{error:#}"
    );
    let retry = armed_guard()
        .clone()
        .expect("candidate must remain published after ambiguous install");
    assert_eq!(retry.intent.mode, KillSwitchStatusMode::Locked);
    assert_eq!(
        crate::direct_endpoint_digest(&retry.direct_endpoints).map_err(anyhow::Error::msg)?,
        digest
    );
    assert_eq!(
        retry.direct_reload.as_ref().map(|lease| lease.phase),
        Some(DirectReloadPhase::Pending)
    );
    assert!(
        retry
            .direct_reload
            .as_ref()
            .and_then(|lease| lease.expires_at)
            .is_some_and(|deadline| deadline <= std::time::Instant::now()),
        "the ambiguous candidate must be poisoned for watchdog retraction"
    );

    drop(failures);
    transition_direct_to_blocked_unlocked(retry, Some(core), None).await?;
    assert!(armed_guard().as_ref().unwrap().direct_endpoints.is_empty());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn every_direct_begin_invalidates_the_previous_reload_identity() -> Result<()> {
    cleanup().await;
    locked_direct_test_session().await?;
    let first = begin_direct_runtime_reload(77).await?;
    let second = begin_direct_runtime_reload(77).await?;
    assert_ne!(first.reload_id, second.reload_id);
    assert_ne!(first.reload_id, 0);
    assert_ne!(second.reload_id, 0);

    let error = replace_direct_endpoints(
        &test_config_with_direct().direct_endpoints,
        &crate::REVIEWED_DIRECT_PORTS,
        77,
        first.reload_id,
    )
    .await
    .expect_err("a delayed request from the old bracket must be rejected");
    assert!(format!("{error:#}").contains("stale"));
    let armed = armed_guard().clone().expect("still armed");
    assert_eq!(armed.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(armed.direct_reload.is_none());
    assert!(armed.direct_endpoints.is_empty());

    // Selected proxy endpoints are deliberately non-empty. The status proof must hash the
    // volatile DIRECT set instead, or an empty DIRECT bracket is reported as non-empty.
    let status = status().await;
    assert!(!status.endpoints.is_empty());
    assert_eq!(
        status.direct_endpoint_digest,
        crate::direct_endpoint_digest(&[]).unwrap()
    );
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn direct_replace_is_pending_replayable_and_finalize_is_idempotent() -> Result<()> {
    cleanup().await;
    let core = locked_direct_test_session().await?;
    let begin = begin_direct_runtime_reload(91).await?;
    lock(None).await?;
    let endpoints = test_config_with_direct().direct_endpoints;
    let expected_digest = crate::direct_endpoint_digest(&endpoints).unwrap();
    let replaced = replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 91, begin.reload_id).await?;
    assert_eq!(replaced.reload_id, begin.reload_id);
    assert_eq!(replaced.endpoint_digest, expected_digest);

    let first_deadline = armed_guard()
        .as_ref()
        .and_then(|armed| armed.direct_reload.as_ref())
        .and_then(|lease| lease.expires_at)
        .expect("pending lease has a deadline");
    let replay = replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 91, begin.reload_id).await?;
    assert_eq!(replay, replaced);
    let replayed_lease = armed_guard()
        .as_ref()
        .and_then(|armed| armed.direct_reload.clone())
        .expect("pending lease remains present");
    assert_eq!(replayed_lease.phase, DirectReloadPhase::Pending);
    assert_eq!(replayed_lease.expires_at, Some(first_deadline));

    let finalized =
        finalize_direct_runtime_reload(&expected_digest, 91, begin.reload_id).await?;
    assert_eq!(finalized, replaced);
    let finalized_replay =
        finalize_direct_runtime_reload(&expected_digest, 91, begin.reload_id).await?;
    assert_eq!(finalized_replay, finalized);
    let armed = armed_guard().clone().expect("still armed");
    let lease = armed
        .direct_reload
        .as_ref()
        .expect("committed lease retained");
    assert_eq!(lease.phase, DirectReloadPhase::Committed);
    let committed_deadline = lease
        .expires_at
        .expect("committed lease must expire without heartbeats");
    assert!(
        direct_reload_invalidation_reason(
            &armed,
            Some(core),
            armed.tun_luid,
            std::time::Instant::now(),
        )
        .is_none()
    );
    assert!(
        direct_reload_invalidation_reason(
            &armed,
            Some(core),
            armed.tun_luid,
            committed_deadline + WATCHDOG_PERIOD,
        )
        .is_some_and(|reason| reason.contains("heartbeat lease expired"))
    );
    assert_eq!(status().await.direct_endpoint_digest, expected_digest);

    restrict_bootstrap().await?;
    let blocked = armed_guard().clone().expect("still armed and blocked");
    assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(blocked.direct_endpoints.is_empty());
    assert!(blocked.direct_reload.is_none());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn committed_direct_expiry_retires_core_before_selective_fallback() -> Result<()> {
    cleanup().await;
    committed_direct_test_session(126).await?;
    mark_verified("owner-alice").await?;
    let owner = crate::core::auth::AuthenticatedOwner {
        key: "owner-alice".to_owned(),
        identity: crate::OwnerIdentity::Unix { uid: 97006, gid: 20 },
        app_data_root: std::env::temp_dir(),
        peer_pid: None,
        peer_session_id: None,
    };
    crate::core::desired::persist_owner_core_started(&owner, &crate::ClashConfig::default())
        .await?;
    crate::core::desired::persist_active_owner(&owner).await?;
    armed_guard().as_mut().unwrap().direct_reload.as_mut().unwrap().expires_at =
        Some(std::time::Instant::now());

    spawn_windows_kill_switch_watchdog();
    let retired = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if !status().await.wanted && current_core_instance().await.is_none()
                && crate::core::selective_layer::test_hold_active()
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }).await.is_ok();
    let wanted_core = crate::core::desired::load_owner_desired_state(&owner.key)
        .await?.core_should_be_running;
    let active = crate::core::desired::load_active_owner().await?;
    tokio::fs::remove_file(crate::service_paths().for_owner_key(&owner.key).desired_state_path())
        .await?;
    cleanup().await;

    assert!(retired, "fallback must retire Core and its TUN before applying the AI hold");
    assert!(!wanted_core, "fallback must not replay the retired Core");
    assert!(active.is_none(), "the retired session must no longer own Core");
    Ok(())
}

#[tokio::test]
#[serial]
async fn committed_direct_expiry_does_not_interrupt_its_new_ai_hold() -> Result<()> {
    cleanup().await;
    let (core, _) = committed_direct_test_session(125).await?;
    let removals_before = crate::core::selective_layer::test_active_hold_removals();
    let mut armed = armed_guard().clone().expect("committed session");
    let now = std::time::Instant::now();
    armed.direct_reload.as_mut().unwrap().expires_at = Some(now);
    let reason = direct_reload_invalidation_reason(&armed, Some(core), armed.tun_luid, now)
        .expect("committed heartbeat expiry must invalidate DIRECT");

    reconcile_direct_watchdog_invalidation_unlocked(armed, Some(core), now, reason).await?;
    crate::core::server::retire_expired_fresh_arm(core_arm_epoch()).await?;
    let wanted = status().await.wanted;
    let held = crate::core::selective_layer::test_hold_active();
    let removals_after = crate::core::selective_layer::test_active_hold_removals();
    cleanup().await;

    assert!(!wanted, "ordinary internet must be released on App death");
    assert!(held, "AI services must remain blocked after release");
    assert_eq!(
        removals_after, removals_before,
        "expiry must not delete the AI hold it has just installed"
    );
    Ok(())
}

#[tokio::test]
#[serial]
async fn committed_direct_lease_expiry_releases_only_non_strict_sessions() -> Result<()> {
    cleanup().await;
    let (core, _) = committed_direct_test_session(122).await?;
    let mut armed = armed_guard().clone().expect("committed session");
    let now = std::time::Instant::now();
    armed.direct_reload.as_mut().unwrap().expires_at = Some(now);
    let reason = direct_reload_invalidation_reason(&armed, Some(core), armed.tun_luid, now)
        .expect("committed heartbeat expiry must invalidate DIRECT");
    assert!(reason.contains("heartbeat lease expired"));

    let failures = SimulatedStateFailures::arm(false, true);
    reconcile_direct_watchdog_invalidation_unlocked(armed, Some(core), now, reason)
        .await
        .expect_err("failed live retraction must retry before releasing");
    let retry = armed_guard().clone().expect("failed retraction stays armed");
    assert_eq!(retry.intent.mode, KillSwitchStatusMode::Locked);
    assert!(!retry.direct_endpoints.is_empty());
    assert!(retry.direct_reload.is_some());
    drop(failures);

    let now = std::time::Instant::now();
    let reason = direct_reload_invalidation_reason(&retry, Some(core), retry.tun_luid, now)
        .expect("expired committed receipt must retry release on the next tick");
    reconcile_direct_watchdog_invalidation_unlocked(retry, Some(core), now, reason).await?;
    assert!(lock(None).await.is_err(), "the expired session cannot cancel retirement");
    assert!(mark_verified("owner-alice").await.is_err());
    crate::core::server::retire_expired_fresh_arm(core_arm_epoch()).await?;
    assert!(
        armed_guard().is_none(),
        "non-strict expiry must release the session"
    );
    assert!(!status().await.wanted);
    assert!(!TUNNEL_PERMIT_RENDERED.load(Ordering::Relaxed));
    assert!(
        crate::core::selective_layer::test_hold_active(),
        "non-strict expiry opens general traffic and puts the AI hold back"
    );
    assert_disarmed_tombstone_present().await?;

    committed_direct_test_session(123).await?;
    let armed = armed_guard().clone().expect("committed session before Core loss");
    let now = std::time::Instant::now();
    let reason = direct_reload_invalidation_reason(&armed, None, armed.tun_luid, now)
        .expect("Core ownership loss must retract DIRECT");
    assert!(reason.contains("ownership changed"));
    let failures = SimulatedStateFailures::arm(false, true);
    reconcile_direct_watchdog_invalidation_unlocked(armed, None, now, reason)
        .await
        .expect_err("ownership retraction failure must retry Blocked");
    let retry = armed_guard().clone().expect("ownership retraction retry");
    let now = std::time::Instant::now();
    let reason = direct_reload_invalidation_reason(&retry, None, retry.tun_luid, now)
        .expect("poisoned ownership receipt must still retract");
    drop(failures);
    reconcile_direct_watchdog_invalidation_unlocked(retry, None, now, reason).await?;
    assert_eq!(
        armed_guard().as_ref().unwrap().intent.mode,
        KillSwitchStatusMode::Blocked
    );

    let (core, _) = committed_direct_test_session(124).await?;
    let mut strict = armed_guard().clone().expect("strict committed session");
    strict.intent.strict_kill_switch = true;
    let now = std::time::Instant::now();
    strict.direct_reload.as_mut().unwrap().expires_at = Some(now);
    let reason = direct_reload_invalidation_reason(&strict, Some(core), strict.tun_luid, now)
        .expect("strict heartbeat expiry must still retract DIRECT");
    reconcile_direct_watchdog_invalidation_unlocked(strict, Some(core), now, reason).await?;
    let blocked = armed_guard().clone().expect("strict session stays armed");
    assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(blocked.direct_endpoints.is_empty());
    assert!(blocked.direct_reload.is_none());
    assert!(blocked.tun_luid.is_none());
    assert!(blocked.core_instance.is_none());
    crate::core::selective_layer::remove().await;
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn pending_direct_lease_expiry_reconciles_to_exact_blocked() -> Result<()> {
    cleanup().await;
    let core = locked_direct_test_session().await?;
    let begin = begin_direct_runtime_reload(123).await?;
    lock(None).await?;
    let endpoints = test_config_with_direct().direct_endpoints;
    replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 123, begin.reload_id).await?;

    {
        let mut guard = armed_guard();
        let lease = guard
            .as_mut()
            .and_then(|armed| armed.direct_reload.as_mut())
            .expect("pending lease");
        lease.expires_at = Some(std::time::Instant::now());
    }
    let pending = armed_guard().clone().expect("pending state");
    let reason = direct_reload_invalidation_reason(
        &pending,
        Some(core),
        pending.tun_luid,
        std::time::Instant::now(),
    )
    .expect("watchdog must recognize the expired pending set");
    assert!(reason.contains("expired"));
    transition_direct_to_blocked_unlocked(pending, Some(core), None).await?;

    let blocked = armed_guard().clone().expect("blocked state");
    assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(blocked.direct_endpoints.is_empty());
    assert!(blocked.direct_reload.is_none());
    let rendered = rule_config_for(&blocked, Some(core));
    assert!(rendered.direct_endpoints.is_empty());
    assert!(rendered.tun_luid.is_none());
    assert_eq!(
        status().await.direct_endpoint_digest,
        crate::direct_endpoint_digest(&[]).unwrap()
    );
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn finalize_mismatch_revokes_the_pending_direct_set() -> Result<()> {
    cleanup().await;
    locked_direct_test_session().await?;
    let begin = begin_direct_runtime_reload(144).await?;
    lock(None).await?;
    let endpoints = test_config_with_direct().direct_endpoints;
    replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 144, begin.reload_id).await?;

    let error = finalize_direct_runtime_reload(&"0".repeat(64), 144, begin.reload_id)
        .await
        .expect_err("a digest mismatch cannot commit physical permits");
    assert!(format!("{error:#}").contains("digest"));
    let blocked = armed_guard().clone().expect("blocked state");
    assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(blocked.direct_endpoints.is_empty());
    assert!(blocked.direct_reload.is_none());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn authenticated_renewal_extends_only_the_exact_committed_lease() -> Result<()> {
    cleanup().await;
    locked_direct_test_session().await?;
    let begin = begin_direct_runtime_reload(145).await?;
    lock(None).await?;
    let endpoints = test_config_with_direct().direct_endpoints;
    let digest = crate::direct_endpoint_digest(&endpoints).unwrap();
    replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 145, begin.reload_id).await?;
    finalize_direct_runtime_reload(&digest, 145, begin.reload_id).await?;
    let first_deadline = armed_guard()
        .as_ref()
        .and_then(|armed| armed.direct_reload.as_ref())
        .and_then(|lease| lease.expires_at)
        .expect("committed deadline");

    let renewed = renew_direct_runtime_reload(&digest, 145, begin.reload_id).await?;
    assert_eq!(renewed.endpoint_digest, digest);
    let second_deadline = armed_guard()
        .as_ref()
        .and_then(|armed| armed.direct_reload.as_ref())
        .and_then(|lease| lease.expires_at)
        .expect("renewed deadline");
    assert!(second_deadline > first_deadline);
    assert_eq!(
        armed_guard()
            .as_ref()
            .and_then(|armed| armed.direct_reload.as_ref())
            .map(|lease| lease.phase),
        Some(DirectReloadPhase::Committed)
    );
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn mismatched_renewal_does_not_block_the_network() -> Result<()> {
    cleanup().await;
    locked_direct_test_session().await?;
    let begin = begin_direct_runtime_reload(146).await?;
    lock(None).await?;
    let endpoints = test_config_with_direct().direct_endpoints;
    let digest = crate::direct_endpoint_digest(&endpoints).unwrap();
    replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 146, begin.reload_id).await?;
    finalize_direct_runtime_reload(&digest, 146, begin.reload_id).await?;

    let error = renew_direct_runtime_reload(&"0".repeat(64), 146, begin.reload_id)
        .await
        .expect_err("a heartbeat for another endpoint set must not renew");
    let message = format!("{error:#}");
    assert!(
        message.contains(DIRECT_RENEW_FAILED_PREFIX),
        "{message}"
    );
    assert!(!message.contains("traffic is Blocked"), "{message}");
    let still = armed_guard().clone().expect("renewal failure must not disarm by itself");
    assert_eq!(still.intent.mode, KillSwitchStatusMode::Locked);
    assert!(!still.direct_endpoints.is_empty());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn failed_blocked_render_never_publishes_an_empty_direct_set() -> Result<()> {
    cleanup().await;
    let core = locked_direct_test_session().await?;
    let begin = begin_direct_runtime_reload(147).await?;
    lock(None).await?;
    let endpoints = test_config_with_direct().direct_endpoints;
    let digest = crate::direct_endpoint_digest(&endpoints).unwrap();
    replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 147, begin.reload_id).await?;
    finalize_direct_runtime_reload(&digest, 147, begin.reload_id).await?;

    let committed = armed_guard().clone().expect("committed state");
    let failures = SimulatedStateFailures::arm(false, true);
    let result = transition_direct_to_blocked_unlocked(committed, Some(core), None).await;
    result.expect_err("the simulated WFP narrowing must fail");

    let retry = armed_guard()
        .clone()
        .expect("prior live state remains published");
    assert_eq!(retry.intent.mode, KillSwitchStatusMode::Locked);
    assert_eq!(
        crate::direct_endpoint_digest(&retry.direct_endpoints).unwrap(),
        digest
    );
    assert!(
        retry
            .direct_reload
            .as_ref()
            .and_then(|lease| lease.expires_at)
            .is_some_and(|deadline| deadline <= std::time::Instant::now()),
        "the retained receipt must be poisoned so the watchdog retries Blocked"
    );
    assert_eq!(status().await.direct_endpoint_digest, digest);

    drop(failures);
    transition_direct_to_blocked_unlocked(retry, Some(core), None).await?;
    let blocked = armed_guard().clone().expect("retry committed Blocked");
    assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(blocked.direct_endpoints.is_empty());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn core_replacement_during_pending_direct_commit_fails_closed() -> Result<()> {
    cleanup().await;
    locked_direct_test_session().await?;
    let begin = begin_direct_runtime_reload(155).await?;
    lock(None).await?;
    let endpoints = test_config_with_direct().direct_endpoints;
    replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 155, begin.reload_id).await?;
    crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 8)))
        .await;

    let error = replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 155, begin.reload_id)
        .await
        .expect_err("a recycled PID with a new restart count is a different Core");
    assert!(format!("{error:#}").contains("locked tunnel grant"));
    let blocked = armed_guard().clone().expect("blocked state");
    assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(blocked.direct_endpoints.is_empty());
    assert!(blocked.direct_reload.is_none());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn same_pid_tunnel_luid_recreation_revokes_the_pending_direct_set() -> Result<()> {
    cleanup().await;
    locked_direct_test_session().await?;
    let begin = begin_direct_runtime_reload(166).await?;
    lock(None).await?;
    let endpoints = test_config_with_direct().direct_endpoints;
    let digest = crate::direct_endpoint_digest(&endpoints).unwrap();
    replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 166, begin.reload_id).await?;

    // The test engine resolves the live alias to LUID 0. Changing only the recorded LUID
    // models same-PID Mihomo recreating WinTUN between replacement and finalize.
    armed_guard().as_mut().expect("pending state").tun_luid = Some(77);
    let error = finalize_direct_runtime_reload(&digest, 166, begin.reload_id)
        .await
        .expect_err("a same-PID tunnel replacement must invalidate physical permits");
    assert!(format!("{error:#}").contains("TUN"));
    let blocked = armed_guard().clone().expect("blocked state");
    assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
    assert!(blocked.direct_endpoints.is_empty());
    assert!(blocked.direct_reload.is_none());
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn direct_security_identity_stays_coherent_during_harmless_manager_contention() {
    cleanup().await;
    crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((5151, 4)))
        .await;
    assert_eq!(
        current_core_instance_for_direct_security(),
        Some(CoreInstance {
            pid: 5151,
            generation: 4,
        })
    );

    let manager = crate::core::manager::CORE_MANAGER.lock().await;
    assert_eq!(
        current_core_instance_for_direct_security(),
        Some(CoreInstance {
            pid: 5151,
            generation: 4,
        }),
        "one packed atomic read must not convert harmless lock contention into owner loss"
    );
    drop(manager);
    cleanup().await;
}

#[tokio::test]
#[serial]
async fn initial_arm_refuses_direct_endpoints_outside_a_reload_lease() {
    cleanup().await;
    let error = arm_bootstrap(
        &test_config_with_direct(),
        "/opt/tono/mihomo",
        "owner-alice",
    )
    .await
    .expect_err("StartClash must not bypass the lease-backed DIRECT transaction");
    assert!(format!("{error:#}").contains("runtime-reload transaction"));
    assert!(armed_guard().is_none());
    cleanup().await;
}

/// P2: `lock` records the core instance and renders the permit from it. Reading the core
/// twice let the two disagree — `status_snapshot_nonblocking` serves a cache whenever the
/// core manager is busy — and a disagreement is permanent, because `tunnel_permit_luid`
/// refuses to revive an unidentified grant. One read, threaded through, cannot disagree.
#[test]
fn locking_renders_the_permit_from_the_very_instance_it_recorded() {
    let running = CoreInstance {
        pid: 4242,
        generation: 3,
    };
    for recorded in [
        None,
        Some(running),
        Some(CoreInstance {
            pid: 1,
            generation: 0,
        }),
    ] {
        let armed = Armed {
            intent: valid_intent(KillSwitchStatusMode::Locked, true),
            tun_luid: Some(0x7777),
            core_instance: recorded,
            direct_endpoints: Vec::new(),
            reviewed_direct_ports: Vec::new(),
            direct_reload: None,
        };
        // This is exactly what `lock` now does: `armed.core_instance` and the render's
        // `current_core` are the same value.
        assert_eq!(
            rule_config_for(&armed, armed.core_instance).tun_luid,
            recorded.map(|_| 0x7777),
            "a render from the recorded instance agrees with it by construction"
        );
    }

    // The defect this replaces: read #1 missed the core, read #2 saw it. The permit is
    // retracted at the instant it is granted — and `None` can never match again, so the
    // machine stays Locked, verified and live with every application's traffic dropped
    // leaving the TUN.
    let stale = Armed {
        intent: valid_intent(KillSwitchStatusMode::Locked, true),
        tun_luid: Some(0x7777),
        core_instance: None,
        direct_endpoints: Vec::new(),
        reviewed_direct_ports: Vec::new(),
        direct_reload: None,
    };
    assert_eq!(rule_config_for(&stale, Some(running)).tun_luid, None);
    assert_eq!(
        rule_config_for(&stale, None).tun_luid,
        None,
        "and no later tick can revive it"
    );
}

/// The observability half: `mode` alone cannot tell "Locked and carrying traffic" from
/// "Locked with the permit retracted". `tunnel_permit_rendered` changes only after the exact
/// install/verify operation succeeds, never while merely constructing an expected model.
#[tokio::test]
#[serial]
async fn the_status_flag_tracks_what_the_last_exact_install_proved() {
    let running = CoreInstance {
        pid: 90,
        generation: 0,
    };
    let armed = Armed {
        intent: valid_intent(KillSwitchStatusMode::Locked, true),
        tun_luid: Some(0x99),
        core_instance: Some(running),
        direct_endpoints: Vec::new(),
        reviewed_direct_ports: Vec::new(),
        direct_reload: None,
    };

    install_unlocked_for(&armed, Some(running)).await.unwrap();
    assert!(TUNNEL_PERMIT_RENDERED.load(Ordering::Relaxed));

    // Same mode, same `wanted`/`verified`/`live` — only this flag changes.
    install_unlocked_for(&armed, None).await.unwrap();
    assert!(!TUNNEL_PERMIT_RENDERED.load(Ordering::Relaxed));
}

/// P1: `live` is a staleness cache, and its budget has to cover a **successful** but slow
/// watchdog tick. At 1.5 s it did not: one sleep (1 s) plus a verify that this module
/// itself calls merely "pathological but reportable" at `WFP_SLOW_CALL` (2 s) already
/// exceeds it, so a healthy machine reported `live: false` and the app read it as unhealthy.
#[test]
fn the_verify_cache_survives_a_slow_but_successful_watchdog_tick() {
    assert!(
        VERIFY_CACHE_TTL > WATCHDOG_PERIOD + WFP_SLOW_CALL,
        "the budget must cover a whole slow-but-successful refresh interval"
    );
    assert!(
        VERIFY_CACHE_TTL <= std::time::Duration::from_secs(10),
        "and stay far below the 25 s call timeout, so a wedged engine still reads dead"
    );

    let slow_tick = std::time::Instant::now()
        .checked_sub(WATCHDOG_PERIOD + WFP_SLOW_CALL)
        .expect("the test host has been up for more than three seconds");
    assert!(
        verify_reads_live(Some((slow_tick, true))),
        "a successful verify that merely took a long time is still alive"
    );

    // What the TTL must never soften.
    assert!(
        !verify_reads_live(Some((std::time::Instant::now(), false))),
        "a verify that actually failed is dead immediately, TTL or no TTL"
    );
    assert!(!verify_reads_live(None), "no verify has ever run");
    let expired = std::time::Instant::now()
        .checked_sub(VERIFY_CACHE_TTL + std::time::Duration::from_millis(1))
        .expect("the test host has been up for more than the TTL");
    assert!(
        !verify_reads_live(Some((expired, true))),
        "an answer older than the budget is stale, not live"
    );
}

#[tokio::test]
#[serial]
async fn lock_grants_the_tunnel_permit_against_the_running_core_and_restrict_revokes_it()
-> Result<()> {
    cleanup().await;
    crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
        .await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    assert!(armed_guard().as_ref().unwrap().core_instance.is_none());

    lock(None).await?;
    let armed = armed_guard().clone().expect("armed");
    assert_eq!(armed.tun_luid, Some(0));
    assert_eq!(
        armed.core_instance,
        current_core_instance().await,
        "the grant names the core that was running when lock ran"
    );
    assert!(armed.core_instance.is_some());
    assert_eq!(render(&armed).await.tun_luid, Some(0));

    restrict_bootstrap().await?;
    let armed = armed_guard().clone().expect("still armed");
    assert!(armed.tun_luid.is_none());
    assert!(
        armed.core_instance.is_none(),
        "the grant is given back with the LUID"
    );
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn release_is_refused_until_dns_restore_is_proven() -> Result<()> {
    cleanup().await;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    simulate_machine_still_on_loopback_dns();
    atomic_write(&dns_snapshot_path(), b"{ corrupt").await?;

    let error = release()
        .await
        .expect_err("release must be refused while DNS restore is unproven");
    assert!(format!("{error:#}").contains("corrupt"));
    assert!(
        ARMED.lock().unwrap().is_some(),
        "a refused release keeps the block armed"
    );
    assert!(tokio::fs::metadata(intent_path()).await.is_ok());

    tokio::fs::remove_file(dns_snapshot_path()).await?;
    let status = release().await?;
    assert!(!status.wanted);
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn restored_locked_intent_relocks_after_core_restore() -> Result<()> {
    cleanup().await;
    TEST_CORE_STARTING.store(true, Ordering::Relaxed);
    let intent = valid_intent(KillSwitchStatusMode::Locked, true);
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

    restore_on_service_start().await?;
    // Downgraded for safety — and marked for re-lock once the core is back.
    assert_eq!(
        ARMED.lock().unwrap().as_ref().unwrap().intent.mode,
        KillSwitchStatusMode::Blocked
    );

    crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
        .await;
    relock_restored_tunnel().await?;
    let armed = ARMED.lock().unwrap().clone().expect("still armed");
    assert_eq!(armed.intent.mode, KillSwitchStatusMode::Locked);
    assert_eq!(armed.tun_luid, Some(0));

    // The marker is consumed: a second call is a no-op and cannot re-lock a
    // restrict-bootstrap that happened in between.
    restrict_bootstrap().await?;
    relock_restored_tunnel().await?;
    assert_eq!(
        ARMED.lock().unwrap().as_ref().unwrap().intent.mode,
        KillSwitchStatusMode::Blocked
    );
    cleanup().await;
    Ok(())
}

#[tokio::test]
#[serial]
async fn direct_endpoints_are_validated_against_the_wechat_contract() -> Result<()> {
    cleanup().await;
    let base = test_config();

    // Port contract: tcp only 80/443, udp only 443/8000.
    for (port, protocol) in [(22_u16, ProxyProtocol::Tcp), (53, ProxyProtocol::Udp)] {
        let mut config = base.clone();
        config.direct_endpoints = vec![ProxyEndpoint {
            ip: "203.0.113.9".to_owned(),
            port,
            protocol,
        }];
        assert!(
            validate_direct_endpoints(&config).is_err(),
            "accepted port {port}/{protocol:?}"
        );
    }
    // Permanently protected resolvers, private space, and the selected node address
    // itself must never go DIRECT.
    for ip in [
        "1.1.1.1",
        "8.8.8.8",
        "10.0.0.9",
        "127.0.0.1",
        "169.254.1.1",
        "100.64.0.1",
        "198.18.0.1",
        "203.0.113.9",
        "224.0.0.1",
        "2001:4860:4860::8888",
    ] {
        let mut config = base.clone();
        config.direct_endpoints = vec![ProxyEndpoint {
            ip: ip.to_owned(),
            port: 443,
            protocol: ProxyProtocol::Tcp,
        }];
        assert!(validate_direct_endpoints(&config).is_err(), "accepted {ip}");
    }
    let mut config = base.clone();
    config.proxy_endpoints = vec![ProxyEndpoint {
        ip: "9.9.9.9".to_owned(),
        port: 443,
        protocol: ProxyProtocol::Tcp,
    }];
    config.direct_endpoints = vec![ProxyEndpoint {
        ip: "9.9.9.9".to_owned(),
        port: 443,
        protocol: ProxyProtocol::Tcp,
    }];
    assert!(
        validate_direct_endpoints(&config).is_err(),
        "accepted the selected node address as DIRECT"
    );

    let mut config = base.clone();
    config.direct_endpoints = vec![ProxyEndpoint {
        ip: "9.0.0.9".to_owned(),
        port: 443,
        protocol: ProxyProtocol::Tcp,
    }];
    validate_direct_endpoints(&config)
        .expect("a public exact WeChat endpoint should be accepted");

    // The 256-entry bound.
    let mut config = base.clone();
    config.direct_endpoints = (0..257_u32)
        .map(|index| ProxyEndpoint {
            ip: format!("203.0.{}.{}", 113 + index / 256, index % 256),
            port: 443,
            protocol: ProxyProtocol::Tcp,
        })
        .collect();
    assert!(
        validate_direct_endpoints(&config).is_err(),
        "accepted more than 256 direct endpoints"
    );
    cleanup().await;
    Ok(())
}

/// `proxy_endpoints` is the list every ALE session filter is emitted from, and the
/// intent carrying it is persisted with `wanted: true` *before* the WFP transaction
/// runs. An unbounded list therefore arms the machine fail-closed with an install too
/// large to finish, replayed at every service start. Every sibling list is bounded;
/// this one must be too.
#[tokio::test]
async fn replace_proxy_endpoints_rejects_empty() {
    assert!(replace_proxy_endpoints(&[]).await.is_err());
}

#[test]
fn proxy_endpoints_are_bounded_like_every_sibling_list() {
    let mut config = test_config();
    config.proxy_endpoints = (0..MAX_PROXY_ENDPOINTS as u32)
        .map(|index| ProxyEndpoint {
            ip: format!("198.51.{}.{}", index / 256, index % 256),
            port: 443,
            protocol: ProxyProtocol::Tcp,
        })
        .collect();
    validate_config(&config).expect("the bound itself must still be accepted");

    config.proxy_endpoints.push(ProxyEndpoint {
        ip: "198.51.101.1".to_owned(),
        port: 443,
        protocol: ProxyProtocol::Tcp,
    });
    let err = validate_config(&config)
        .expect_err("accepted an unbounded proxy_endpoints list")
        .to_string();
    assert!(
        err.contains("proxy_endpoints"),
        "the refusal must name the list that was too long, got {err}"
    );

    // A real session carries the selected node plus at most the home route.
    assert!(validate_config(&test_config()).is_ok());
}

/// The S1 residual risk in miniature: a WFP call that never returns must produce a
/// mappable error, and the abandoned blocking thread must keep the single-writer claim
/// until the kernel call really comes back. The FFI is mock-gated off Windows, so the
/// closure stands in for a wedged `Fwpm*` call — the ownership rules under test are the
/// engine-independent part.
#[tokio::test]
#[serial]
async fn a_wedged_engine_call_times_out_and_blocks_a_second_wfp_writer() -> Result<()> {
    let (release, blocked) = std::sync::mpsc::channel::<()>();
    let wedged = move || -> Result<()> {
        // Returns only when the test says so — the stand-in for a BFE that never answers.
        let _ = blocked.recv_timeout(std::time::Duration::from_secs(30));
        Ok(())
    };

    let timed_out =
        bounded_engine_call(std::time::Duration::from_millis(50), "install", wedged)
            .await
            .expect_err("a call that never returns must not be awaited forever");
    let message = format!("{timed_out:#}");
    assert!(message.contains(WFP_ENGINE_WEDGED_PREFIX), "{message}");
    assert!(message.contains("install"), "{message}");

    // The claim is still held by the running thread, so nothing may start a second WFP
    // transaction — the refusal names the operation that is stuck.
    let refused = bounded_engine_call(std::time::Duration::from_secs(5), "verify", || Ok(()))
        .await
        .expect_err("a second writer must be refused while the first is inside the kernel");
    let message = format!("{refused:#}");
    assert!(message.contains(WFP_ENGINE_WEDGED_PREFIX), "{message}");
    assert!(message.contains("install"), "{message}");

    // Only the abandoned call itself releases the claim, and it does so on its own thread.
    release.send(()).expect("the wedged call is still running");
    for _ in 0..300 {
        if engine_call_in_flight().is_none() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(
        engine_call_in_flight().is_none(),
        "the blocking thread must release the claim when the call finally returns"
    );
    bounded_engine_call(std::time::Duration::from_secs(5), "install", || Ok(())).await?;
    Ok(())
}

#[tokio::test]
#[serial]
async fn a_healthy_engine_call_leaves_no_claim_behind() -> Result<()> {
    bounded_engine_call(std::time::Duration::from_secs(5), "install", || Ok(())).await?;
    assert!(
        engine_call_in_flight().is_none(),
        "a completed call must not keep the next operation out"
    );
    let error = bounded_engine_call(
        std::time::Duration::from_secs(5),
        "verify",
        || -> Result<()> { bail!("engine said no") },
    )
    .await
    .expect_err("engine errors still propagate");
    assert!(format!("{error:#}").contains("engine said no"));
    assert!(engine_call_in_flight().is_none());
    Ok(())
}

#[tokio::test]
#[serial]
async fn direct_endpoints_live_only_in_the_armed_session_memory() -> Result<()> {
    cleanup().await;
    locked_direct_test_session().await?;
    let begin = begin_direct_runtime_reload(199).await?;
    lock(None).await?;
    let endpoints = test_config_with_direct().direct_endpoints;
    let digest = crate::direct_endpoint_digest(&endpoints).unwrap();
    replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 199, begin.reload_id).await?;
    finalize_direct_runtime_reload(&digest, 199, begin.reload_id).await?;
    assert_eq!(
        ARMED
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .direct_endpoints
            .len(),
        2
    );

    let armed = armed_guard().clone().expect("still armed");
    // Two exact-tuple permits (rule G), plus the reviewed-port class (rule H): one filter
    // per port per protocol per address family. Derived from the constant rather than
    // written as a literal, so adding a reviewed port cannot quietly change the count.
    // One filter per declared port, TCP only — the UDP half was withdrawn because nothing
    // routes unpinned UDP to the physical interface for it to cover.
    let reviewed = crate::REVIEWED_DIRECT_PORTS.len();
    assert_eq!(
        wfp_model::expected_filters(&render(&armed).await)
            .iter()
            .filter(|filter| filter.name.contains("DIRECT"))
            .count(),
        2 + reviewed,
        "each approved tuple must be one ALE permit carrying both Mihomo identity and the exact tuple"
    );
    let persisted = tokio::fs::read_to_string(intent_path()).await?;
    assert!(
        !persisted.contains("direct_endpoints") && !persisted.contains("reload_id"),
        "volatile DIRECT endpoints and leases must never enter startup intent"
    );

    restrict_bootstrap().await?;
    let armed = armed_guard().clone().expect("still armed");
    assert!(armed.direct_endpoints.is_empty());
    assert!(armed.direct_reload.is_none());
    assert!(
        !wfp_model::expected_filters(&render(&armed).await)
            .iter()
            .any(|filter| filter.name.contains("DIRECT")),
        "Protected Offline must not keep DIRECT permits installed"
    );

    // Startup recovery also rebuilds with an empty set (fail-closed until the App's next
    // authenticated lease transaction). Core is treated as starting so this observes the
    // rebuilt session rather than the idle release.
    TEST_CORE_STARTING.store(true, Ordering::Relaxed);
    restore_on_service_start().await?;
    assert!(
        ARMED
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .direct_endpoints
            .is_empty()
    );

    // And a later arm that omits them inherits nothing from the previous session.
    release().await?;
    arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
    assert!(
        ARMED
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .direct_endpoints
            .is_empty()
    );
    cleanup().await;
    Ok(())
}
