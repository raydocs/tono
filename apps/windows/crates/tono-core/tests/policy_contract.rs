// Windows-only policy edits do not trigger Services/macOS CI. Reuse their
// cross-platform contract in the existing Linux tono-core PR job, rather than
// maintaining another list of protected hosts or another native build matrix.
#[cfg(target_os = "linux")]
#[test]
fn policy_contract_agrees_with_control_plane_and_macos() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..");
    let output = std::process::Command::new("bash")
        .arg(root.join("tooling/scripts/test-policy-signing-contract.sh"))
        .current_dir(&root)
        .output()
        .expect("policy contract requires bash and Node.js (provided by the Linux CI runner)");
    assert!(
        output.status.success(),
        "cross-platform policy contract failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
