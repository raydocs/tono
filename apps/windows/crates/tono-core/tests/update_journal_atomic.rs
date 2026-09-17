use std::{
    fs,
    sync::{Arc, Barrier},
    thread,
};
use tono_core::update_journal::{
    UpdateHandoffJournal, UpdateHandoffPhase, commit_verified_recovery, journal_path, load,
    write_atomic, write_prepared,
};

#[test]
fn existing_scratch_alias_is_not_truncated() {
    let dir = std::env::temp_dir().join(format!("tono-journal-alias-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&dir).unwrap();
    let path = journal_path(&dir);
    let unrelated = dir.join("unrelated-owned-file");
    fs::write(&unrelated, b"keep this evidence").unwrap();
    let legacy_scratch = path.with_extension("json.tmp");
    fs::hard_link(&unrelated, &legacy_scratch).unwrap();
    let journal = UpdateHandoffJournal::new("old", "new", 1, true, true);

    write_atomic(&path, &journal).unwrap();

    assert_eq!(fs::read(&unrelated).unwrap(), b"keep this evidence");
    assert_eq!(fs::read(&legacy_scratch).unwrap(), b"keep this evidence");
    assert_eq!(load(&path).unwrap(), Some(journal));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn concurrent_writes_publish_complete_journals() {
    let dir = std::env::temp_dir().join(format!("tono-journal-writers-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&dir).unwrap();
    let path = journal_path(&dir);
    let barrier = Arc::new(Barrier::new(5));
    let workers: Vec<_> = (0..4)
        .map(|writer| {
            let path = path.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                let mut failures = 0;
                for generation in 0..16 {
                    let mut journal =
                        UpdateHandoffJournal::new("old", "new", generation, true, true);
                    journal.core_version = format!("writer-{writer}");
                    journal.build_commit = "abcdef".repeat(writer * 5 + 1);
                    barrier.wait();
                    failures += usize::from(write_atomic(&path, &journal).is_err());
                    barrier.wait();
                }
                failures
            })
        })
        .collect();
    let mut unreadable = 0;
    for generation in 0..16 {
        barrier.wait();
        barrier.wait();
        unreadable += usize::from(!matches!(load(&path), Ok(Some(journal))
            if journal.connection_generation == generation));
    }
    let failures: usize = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .sum();
    assert_eq!(
        failures, 0,
        "concurrent writers must not share a scratch file"
    );
    assert_eq!(
        unreadable, 0,
        "every completed round must leave a complete journal"
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn stale_commit_cannot_damage_a_concurrent_new_preparation() {
    let dir =
        std::env::temp_dir().join(format!("tono-journal-commit-race-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&dir).unwrap();
    let path = journal_path(&dir);
    let barrier = Arc::new(Barrier::new(2));
    let worker_path = path.clone();
    let worker_barrier = barrier.clone();
    let worker = thread::spawn(move || {
        for _ in 0..32 {
            worker_barrier.wait();
            let _ = commit_verified_recovery(&worker_path, "old-target");
            worker_barrier.wait();
        }
    });
    let mut damaged = 0;
    for generation in 0..32 {
        let mut old = UpdateHandoffJournal::new("previous", "old-target", generation, false, false);
        old.phase = UpdateHandoffPhase::Verified;
        write_atomic(&path, &old).unwrap();
        let next =
            UpdateHandoffJournal::new("old-target", "new-target", generation + 1, true, true);
        barrier.wait();
        let prepared = write_prepared(&path, &next);
        barrier.wait();
        damaged += usize::from(prepared.is_err() || load(&path).ok().flatten() != Some(next));
    }
    worker.join().unwrap();
    assert_eq!(
        damaged, 0,
        "commit must not re-read or delete a replacement attempt"
    );
    fs::remove_dir_all(dir).unwrap();
}
