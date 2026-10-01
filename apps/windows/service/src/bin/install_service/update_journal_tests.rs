// Installer gate regressions use only their own temporary files.

use super::*;

fn pending(phase: &str) -> serde_json::Value {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    serde_json::json!({
        "schemaVersion":1, "phase":phase, "previousAppVersion":"0.0.72", "nextAppVersion":"0.0.73",
        "coreVersion":"", "coreSha256":"", "buildCommit":"", "helperProtocolVersion":"",
        "wasConnected":false, "keepKillSwitchArmed":true, "connectionGeneration":3,
        "createdAtUnix":now, "updatedAtUnix":now, "expiresAtUnix":now+3600,
        "allowCachedResume":true
    })
}

#[test]
fn incomplete_handoff_cannot_be_promoted_to_install_started() {
    let dir = std::env::temp_dir().join(format!("tono-install-incomplete-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("update-handoff.json");
    let original = br#"{"phase":"protectedHandoffRecorded"}"#;
    std::fs::write(&path, original).unwrap();
    assert!(record_install_started_for_paths(&[path.clone()]).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), original);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn expired_install_started_cannot_bypass_validation_on_retry() {
    let dir = std::env::temp_dir().join(format!("tono-install-expired-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("update-handoff.json");
    let mut value = pending("installStarted");
    value["createdAtUnix"] = 1.into();
    value["updatedAtUnix"] = 2.into();
    value["expiresAtUnix"] = 3.into();
    let original = serde_json::to_vec(&value).unwrap();
    std::fs::write(&path, &original).unwrap();
    assert!(record_install_started_for_paths(&[path.clone()]).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), original);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn multiple_pending_handoffs_are_rejected_before_either_is_changed() {
    let dir = std::env::temp_dir().join(format!("tono-install-ambiguous-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let first = dir.join("first.json");
    let second = dir.join("second.json");
    let original = serde_json::to_vec(&pending("protectedHandoffRecorded")).unwrap();
    std::fs::write(&first, &original).unwrap();
    std::fs::write(&second, &original).unwrap();
    assert!(record_install_started_for_paths(&[first.clone(), second.clone()]).is_err());
    assert_eq!(std::fs::read(&first).unwrap(), original);
    assert_eq!(std::fs::read(&second).unwrap(), original);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn unreadable_handoff_aborts_the_installer_gate_and_preserves_evidence() {
    let dir =
        std::env::temp_dir().join(format!("tono-install-corrupt-gate-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("update-handoff.json");
    let original = b"{broken update evidence";
    std::fs::write(&path, original).unwrap();
    assert!(
        record_install_started_for_paths(&[path.clone()]).is_err(),
        "unreadable evidence must stop the replacement caller"
    );
    assert_eq!(std::fs::read(&path).unwrap(), original);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn journal_write_never_truncates_a_preexisting_scratch_hardlink() {
    let dir =
        std::env::temp_dir().join(format!("tono-install-scratch-gate-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("update-handoff.json");
    let victim = dir.join("unrelated-evidence");
    std::fs::write(&victim, b"must remain intact").unwrap();
    std::fs::hard_link(&victim, path.with_extension("json.tmp")).unwrap();
    write_update_handoff_atomic(&path, &serde_json::json!({"phase":"installStarted"})).unwrap();
    assert_eq!(
        std::fs::read(&victim).unwrap(),
        b"must remain intact",
        "an elevated journal writer must not truncate preexisting scratch entries"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn persist_failure_is_returned_without_replacing_the_previous_journal() {
    let dir =
        std::env::temp_dir().join(format!("tono-install-save-failure-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("update-handoff.json");
    let original = serde_json::to_vec(&pending("protectedHandoffRecorded")).unwrap();
    std::fs::write(&path, &original).unwrap();
    let error = record_with_writer(&[path.clone()], |_, next| {
        assert_eq!(next["phase"], "installStarted");
        Err(io::Error::new(
            io::ErrorKind::StorageFull,
            "injected journal persistence failure",
        ))
    })
    .unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::StorageFull);
    assert_eq!(std::fs::read(&path).unwrap(), original);
    std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn replace_runtime_records_install_started_on_protected_handoff() {
    let dir = std::env::temp_dir().join(format!(
        "tono-install-journal-{}-{}",
        std::process::id(),
        "ok"
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("update-handoff.json");
    let mut original = pending("protectedHandoffRecorded");
    original["futureMetadata"] = serde_json::json!({"preserve":true});
    write_update_handoff_atomic(&path, &original).unwrap();
    assert!(record_install_started_on_journal(&path).unwrap());
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(value["phase"], "installStarted");
    assert_eq!(value["futureMetadata"], original["futureMetadata"]);
    let recorded_bytes = std::fs::read(&path).unwrap();
    assert!(record_install_started_on_journal(&path).unwrap());
    assert_eq!(std::fs::read(&path).unwrap(), recorded_bytes);
    let again: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(again["phase"], "installStarted");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn installer_cannot_skip_a_required_or_unknown_protected_handoff() {
    let dir = std::env::temp_dir().join(format!(
        "tono-install-protected-shortcut-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("update-handoff.json");
    let mut value = pending("cleanShutdownCompleted");
    write_update_handoff_atomic(&path, &value).unwrap();
    assert!(record_install_started_on_journal(&path).is_err());
    let failed: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(failed["phase"], "failed");
    assert_eq!(failed["lastErrorCode"], "TONO_JOURNAL_ILLEGAL_PHASE");
    let failed_bytes = std::fs::read(&path).unwrap();
    assert!(
        !record_install_started_on_journal(&path).unwrap(),
        "terminal failure stays evidence, not an install attempt"
    );
    assert_eq!(std::fs::read(&path).unwrap(), failed_bytes);

    // An incomplete legacy journal is not affirmative evidence of no protection.
    value.as_object_mut().unwrap().remove("keepKillSwitchArmed");
    write_update_handoff_atomic(&path, &value).unwrap();
    assert!(record_install_started_on_journal(&path).is_err());

    value["keepKillSwitchArmed"] = serde_json::Value::Bool(false);
    write_update_handoff_atomic(&path, &value).unwrap();
    assert!(
        record_install_started_on_journal(&path).unwrap(),
        "genuinely unprotected installs still work"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn replace_runtime_does_not_invent_or_skip_to_install_started() {
    let missing = std::env::temp_dir().join(format!(
        "tono-install-missing-handoff-{}.json",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&missing);
    assert!(!record_install_started_on_journal(&missing).unwrap());
    assert!(!missing.exists());

    let dir = std::env::temp_dir().join(format!(
        "tono-install-journal-{}-{}",
        std::process::id(),
        "skip"
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("update-handoff.json");
    write_update_handoff_atomic(&path, &pending("updatePrepared")).unwrap();
    assert!(record_install_started_on_journal(&path).is_err());
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(value["phase"], "failed");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn journal_gate_refusal_is_non_retryable_in_the_nsis_caller() {
    // Contract check, not a claim that NSIS/WFP was executed on this host.
    let template = include_str!("../../../../app/src-tauri/packages/windows/installer.nsi");
    assert!(template.contains(&format!(
        "!define TONO_JOURNAL_GATE_REJECTED_EXIT_CODE {}",
        JOURNAL_GATE_REJECTED_EXIT_CODE
    )));
    let branch = template
        .split("${ElseIf} $0 == ${TONO_JOURNAL_GATE_REJECTED_EXIT_CODE}")
        .nth(1)
        .expect("journal refusal must be handled before the generic retry");
    let rejection = branch.split("${ElseIf} $0 != \"0\"").next().unwrap();
    assert!(branch.contains("${ElseIf} $0 != \"0\""));
    assert!(rejection.contains("StrCpy $ServiceInstallAttempted 0"));
    assert!(rejection.contains("Abort "));
    assert!(!rejection.contains("Goto serviceInstallAttempt"));
}
