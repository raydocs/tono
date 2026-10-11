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

fn idle() -> Processes {
    Processes {
        alive: Box::new(|_| Some(false)),
        boot_session: Box::new(|| Some("boot".into())),
    }
}

fn released(generation: u64) -> Record {
    Record {
        mode: Mode::Released,
        generation,
        worker_boot_session: Some("boot".into()),
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
fn a_connect_for_an_older_secured_generation_is_stale() {
    let secured = Record {
        generation: 20,
        ..Record::default()
    };
    assert_eq!(start_verdict(&secured, Some(19)), StartVerdict::Stale);
}

#[test]
fn a_live_worker_blocks_admission() {
    let live = Processes {
        alive: Box::new(|incarnation| Some(incarnation.pid == 4242)),
        boot_session: Box::new(|| Some("boot".into())),
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
        boot_session: Box::new(|| Some("boot".into())),
    };
    let mut record = released(3);
    record.stuck = vec![Incarnation {
        pid: 99,
        started_at: 3,
    }];
    assert!(unknown.unretired_reason(&record).is_some());
}

#[test]
fn a_record_from_an_earlier_boot_does_not_block() {
    let alive = Processes {
        alive: Box::new(|_| Some(true)),
        boot_session: Box::new(|| Some("this boot".into())),
    };
    let mut record = released(3);
    record.worker_boot_session = Some("earlier boot".into());
    record.stuck = vec![Incarnation {
        pid: 99,
        started_at: 3,
    }];
    assert!(alive.unretired_reason(&record).is_none());
}
