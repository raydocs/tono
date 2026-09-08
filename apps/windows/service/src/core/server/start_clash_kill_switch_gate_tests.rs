use super::start_clash_kill_switch_rejection;

#[test]
fn linux_refuses_start_without_a_barrier() {
    assert_eq!(
        start_clash_kill_switch_rejection("linux", false, false, false),
        Some("Linux kill switch is not implemented; refusing to start without a barrier"),
    );
}

#[test]
fn linux_does_not_accept_a_windows_kill_switch_payload() {
    assert_eq!(
        start_clash_kill_switch_rejection("linux", false, true, false),
        Some("Windows kill switch is unsupported on this platform"),
    );
}

#[test]
fn macos_kill_switch_stays_macos_only() {
    assert_eq!(
        start_clash_kill_switch_rejection("linux", true, false, false),
        Some("macOS kill switch is unsupported on this platform"),
    );
    assert_eq!(
        start_clash_kill_switch_rejection("macos", true, false, false),
        None,
    );
}

#[test]
fn windows_live_binary_requires_its_kill_switch() {
    assert_eq!(
        start_clash_kill_switch_rejection("windows", false, false, true),
        Some("Windows kill switch configuration is required"),
    );
    assert_eq!(
        start_clash_kill_switch_rejection("windows", false, true, true),
        None,
    );
    assert_eq!(
        start_clash_kill_switch_rejection("windows", false, false, false),
        None,
    );
}
