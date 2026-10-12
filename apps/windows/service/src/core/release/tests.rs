use super::*;

fn scratch() -> PathBuf {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let directory = std::env::temp_dir().join(format!(
        "tono-release-test-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    directory
}

fn stamp(marker: &str) -> BootStamp {
    BootStamp {
        marker: Some(marker.into()),
        booted_at: None,
        uptime_ms: None,
    }
}

fn no_broker() -> Box<dyn Fn() -> Result<Vec<crate::core::dns::broker_ledger::Pending>> + Send + Sync> {
    Box::new(|| Ok(Vec::new()))
}

fn idle() -> Processes {
    Processes {
        alive: Box::new(|_| Some(false)),
        boot: Box::new(|| stamp("boot")),
        broker: no_broker(),
    }
}

/// A release that finished and was completed by the release service.
fn released(generation: u64) -> Record {
    Record {
        mode: Mode::Released,
        generation,
        worker_boot: Some(stamp("boot")),
        worker_finished: true,
        completed: true,
        ..Record::default()
    }
}

#[test]
fn a_missing_record_is_secured_at_generation_zero() {
    assert_eq!(Authority::new(scratch()).load().unwrap(), Record::default());
}

#[test]
fn a_corrupt_record_refuses_admission() {
    let authority = Authority::new(scratch());
    std::fs::write(authority.record_path(), b"{").unwrap();
    let refusal = authority
        .admit_start(None, Duration::from_millis(100), &idle(), || Ok(()))
        .unwrap_err();
    assert!(matches!(refusal, AdmissionRefusal::Corrupt(_)));
}

#[test]
fn admission_without_the_lock_changes_nothing() {
    let authority = Authority::new(scratch());
    authority.save(&released(7)).unwrap();
    let _held = authority.lock(Duration::from_secs(1)).unwrap().unwrap();
    // flock is per open file description, so a second open in this process contends.
    let refusal = authority
        .admit_start(None, Duration::from_millis(100), &idle(), || Ok(()))
        .unwrap_err();
    assert_eq!(refusal, AdmissionRefusal::InProgress);
    assert_eq!(authority.load().unwrap(), released(7));
}

#[test]
fn admission_after_a_finished_release_secures_a_new_generation_and_restores_the_executor() {
    let authority = Authority::new(scratch());
    let mut record = released(7);
    record.executor_quarantined = true;
    record.service_quarantined = true;
    authority.save(&record).unwrap();
    let mut restores = 0;
    let generation = authority
        .admit_start(Some(7), Duration::from_millis(100), &idle(), || {
            restores += 1;
            Ok(())
        })
        .unwrap();
    let after = authority.load().unwrap();
    assert!(generation > 7);
    assert_eq!((after.mode, after.generation), (Mode::Secured, generation));
    assert!(!after.executor_quarantined && !after.service_quarantined);
    assert_eq!(restores, 1);
}

#[test]
fn a_connect_prepared_before_the_release_is_stale() {
    assert_eq!(start_verdict(&released(21), Some(20)), StartVerdict::Stale);
}

#[test]
fn a_connect_without_a_generation_after_a_release_is_stale() {
    assert_eq!(start_verdict(&released(21), None), StartVerdict::Stale);
}

#[test]
fn a_connect_for_an_older_secured_generation_is_stale() {
    let secured = Record {
        generation: 20,
        ..Record::default()
    };
    assert_eq!(start_verdict(&secured, Some(19)), StartVerdict::Stale);
}

#[test]
fn a_start_without_a_generation_after_an_admission_is_stale() {
    let secured = Record {
        generation: 20,
        ..Record::default()
    };
    assert_eq!(start_verdict(&secured, None), StartVerdict::Stale);
}

#[test]
fn an_old_teardown_cannot_reach_a_newer_session() {
    let newer = Record {
        generation: 22,
        ..Record::default()
    };
    assert!(!release_generation_verdict(&newer, Some(20)));
    assert!(!release_generation_verdict(&newer, None));
    assert!(release_generation_verdict(&newer, Some(22)));
}

#[test]
fn a_live_worker_blocks_admission() {
    let live = Processes {
        alive: Box::new(|incarnation| Some(incarnation.pid == 4242)),
        boot: Box::new(|| stamp("boot")),
        broker: no_broker(),
    };
    let mut record = released(3);
    record.worker = Some(Incarnation {
        pid: 4242,
        started_at: 1,
    });
    assert!(live.unretired_reason(&record).is_some());
}

#[test]
fn an_unreadable_process_blocks_admission() {
    let unknown = Processes {
        alive: Box::new(|_| None),
        boot: Box::new(|| stamp("boot")),
        broker: no_broker(),
    };
    let mut record = released(3);
    record.stuck = vec![Incarnation {
        pid: 99,
        started_at: 3,
    }];
    assert!(unknown.unretired_reason(&record).is_some());
}

#[test]
fn a_restart_does_not_retire_an_unfinished_release() {
    let after_restart = Processes {
        alive: Box::new(|_| Some(false)),
        boot: Box::new(|| BootStamp {
            marker: Some("this boot".into()),
            booted_at: Some(90_000),
            uptime_ms: Some(1_000),
        }),
        broker: no_broker(),
    };
    let earlier = BootStamp {
        marker: Some("earlier boot".into()),
        booted_at: Some(1_000),
        uptime_ms: Some(80_000),
    };
    let mut record = released(3);
    record.worker_boot = Some(earlier.clone());
    record.worker_finished = false;
    record.completed = false;
    assert!(after_restart.unretired_reason(&record).is_some());
    record.worker_finished = true;
    record.completed = true;
    record.history_lost_boot = Some(earlier);
    let reason = after_restart.unretired_reason(&record).unwrap();
    assert!(reason.contains("choose Restore internet again"), "{reason}");
}

#[test]
fn a_reinstall_or_a_clock_change_within_one_boot_is_not_a_reboot() {
    let before = BootStamp {
        marker: Some("before".into()),
        booted_at: Some(1_000),
        uptime_ms: Some(5_000),
    };
    let reinstalled = BootStamp {
        marker: Some("after".into()),
        booted_at: Some(1_030),
        uptime_ms: Some(9_000),
    };
    assert_eq!(before.relation_to(&reinstalled), BootRelation::Unknown);
    let boot_time_missing = BootStamp {
        marker: Some("after".into()),
        booted_at: None,
        uptime_ms: Some(9_000),
    };
    assert_eq!(before.relation_to(&boot_time_missing), BootRelation::Unknown);
    let clock_moved = BootStamp {
        marker: Some("before".into()),
        booted_at: Some(90_000),
        uptime_ms: Some(9_000),
    };
    assert_eq!(before.relation_to(&clock_moved), BootRelation::Same);
    let marker_unknown = BootStamp {
        marker: None,
        booted_at: Some(90_000),
        uptime_ms: Some(1),
    };
    assert_eq!(before.relation_to(&marker_unknown), BootRelation::Unknown);
}

#[test]
fn a_retry_keeps_the_survivors_of_the_previous_release() {
    let processes = Processes {
        alive: Box::new(|incarnation| Some(incarnation.pid == 7)),
        boot: Box::new(|| stamp("boot")),
        broker: no_broker(),
    };
    let mut record = released(3);
    record.worker = Some(Incarnation { pid: 7, started_at: 1 });
    record.stuck = vec![Incarnation { pid: 8, started_at: 2 }];
    assert_eq!(
        processes.unretired_incarnations(&record),
        vec![Incarnation { pid: 7, started_at: 1 }]
    );
}

#[test]
fn an_unproven_worker_job_blocks_after_its_owner_died() {
    let mut record = released(3);
    record.jobs_unproven = true;
    record.job_owner = Some(Incarnation { pid: 50, started_at: 5 });
    assert!(idle().unretired_reason(&record).is_some());
}

#[test]
fn a_release_the_service_did_not_complete_blocks_admission() {
    let mut record = released(3);
    record.completed = false;
    assert!(idle().unretired_reason(&record).is_some());
}

#[test]
fn a_pending_wmi_dns_change_blocks_even_after_a_crash_before_it_was_flagged() {
    // The release died after its batch began: the record says nothing about the batch, but the
    // ledger does, and admission reads the ledger under C (Sol R2-F1).
    let directory = scratch();
    let in_flight = crate::core::dns::broker_ledger::begin_in(&directory).unwrap();
    std::mem::forget(in_flight);
    let processes = Processes {
        alive: Box::new(|_| Some(false)),
        boot: Box::new(current_boot),
        broker: Box::new(move || crate::core::dns::broker_ledger::outstanding_in(&directory)),
    };
    let reason = processes.unretired_reason(&released(3)).unwrap();
    assert!(reason.contains("restart Windows"), "{reason}");
}

#[test]
fn a_final_read_back_that_disagrees_replaces_the_workers_and_withdraws_settled() {
    use crate::release_wire::{ReleaseComponent, ReleaseReport};
    let component = |name: &str| ReleaseComponent {
        name: name.into(),
        readback: "restored".into(),
        risk: "settled".into(),
        detail: None,
    };
    let mut report = ReleaseReport::without_components("r", "restored", None);
    report.components = vec![component("wfp"), component("dns"), component("core")];
    super::fold_final_readings(
        &mut report,
        &[
            ("wfp", "restored".into(), None),
            ("dns", "residual".into(), None),
        ],
    );
    super::mark_risk_unproven(&mut report);
    let state: Vec<_> = report
        .components
        .iter()
        .map(|component| (component.name.as_str(), component.readback.as_str(), component.risk.as_str()))
        .collect();
    assert_eq!(
        state,
        vec![
            ("wfp", "restored", "unknown"),
            ("dns", "residual", "unknown"),
            ("core", "unreadable", "unknown"),
        ]
    );
    assert_ne!(ReleaseReport::outcome_of(&report.components, &report.stuck, true), "restored");
}
