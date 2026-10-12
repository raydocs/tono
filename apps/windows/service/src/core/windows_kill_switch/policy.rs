//! Release-vs-block policy: strict flag, crash recovery, service stop, unhealthy ticks.

use super::*;

#[cfg(any(windows, test))]
pub(crate) fn strict_kill_switch_enabled() -> bool {
    armed_guard()
        .as_ref()
        .is_some_and(|armed| armed.intent.strict_kill_switch)
}

/// Crash, hang, and unreadable state release general traffic unless the user explicitly
/// enabled the strict kill switch. A missing flag is not that opt-in.
pub(super) fn crash_recovery_releases_network(strict_kill_switch_enabled: bool) -> bool {
    !strict_kill_switch_enabled
}

/// Non-strict unhealthy ticks wait, then release. They do not reinstall a block.
pub(super) const UNHEALTHY_RELEASE_TICKS: u32 = 3;
/// Strict mode keeps repairing, then releases so a wedged engine cannot stay closed forever.
pub(super) const STRICT_UNHEALTHY_RELEASE_TICKS: u32 = 30;

#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn release_on_service_stop(strict_kill_switch_enabled: bool, lifecycle_owned: bool) -> bool {
    !strict_kill_switch_enabled && !lifecycle_owned
}

/// Called under the owner lifecycle and repair gates; an update/installer stop must leave the
/// recorded protection for its successor. Ordinary SCM Stop releases unless strict is on.
#[cfg(windows)]
pub(crate) fn service_stop_release_allowed(lifecycle_owned: bool) -> bool {
    release_on_service_stop(strict_kill_switch_enabled(), lifecycle_owned)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum UnhealthyWatchdogAction {
    Wait,
    Reinstall,
    Release,
}

pub(super) fn unhealthy_watchdog_action(
    strict_kill_switch_enabled: bool,
    consecutive_unhealthy: u32,
) -> UnhealthyWatchdogAction {
    if consecutive_unhealthy == 0 {
        return UnhealthyWatchdogAction::Wait;
    }
    if crash_recovery_releases_network(strict_kill_switch_enabled) {
        if consecutive_unhealthy >= UNHEALTHY_RELEASE_TICKS {
            UnhealthyWatchdogAction::Release
        } else {
            UnhealthyWatchdogAction::Wait
        }
    } else if consecutive_unhealthy >= STRICT_UNHEALTHY_RELEASE_TICKS {
        UnhealthyWatchdogAction::Release
    } else {
        UnhealthyWatchdogAction::Reinstall
    }
}
