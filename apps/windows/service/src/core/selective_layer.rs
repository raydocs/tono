//! Install and remove the secondary AI hold. Best-effort, and only after a
//! full release has already opened the network. A failure here is logged and
//! does not restore the general block.
//!
//! The firewall rules are Windows Firewall entries with a fixed remote prefix,
//! not filters in the kill-switch provider. Residual kill-switch filters are
//! what service start treats as "still armed". Putting this hold in that
//! provider would make the next start install an emergency block-all.

use std::time::Duration;

use super::selective_fail_open;

const STEP_BUDGET: Duration = Duration::from_secs(3);

#[cfg(test)]
static TEST_HOLD_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(test)]
pub(super) fn test_hold_active() -> bool {
    TEST_HOLD_ACTIVE.load(std::sync::atomic::Ordering::SeqCst)
}

pub async fn remove() {
    let _ = tokio::time::timeout(STEP_BUDGET, tokio::task::spawn_blocking(remove_blocking)).await;
}

pub async fn finish_release(apply_narrow: bool) {
    remove().await;
    if apply_narrow && selective_fail_open::follow_up(selective_fail_open::ReleaseKind::CrashOrHang)
        == selective_fail_open::FollowUp::Apply
    {
        let _ = tokio::time::timeout(STEP_BUDGET, tokio::task::spawn_blocking(apply_blocking)).await;
    }
}

#[cfg(all(windows, not(feature = "test")))]
fn remove_blocking() {
    run_commands(&selective_fail_open::firewall_delete_commands());
    if let Err(error) = super::dns::remove_selective_nrpt() {
        tracing::warn!("selective fail-open: NRPT sinkhole could not be removed: {error:#}");
    }
}

#[cfg(all(windows, not(feature = "test")))]
fn apply_blocking() {
    run_commands(&selective_fail_open::firewall_add_commands());
    if let Err(error) = super::dns::install_selective_nrpt() {
        tracing::warn!("selective fail-open: NRPT sinkhole was not installed: {error:#}");
    }
}

#[cfg(not(all(windows, not(feature = "test"))))]
fn remove_blocking() {
    #[cfg(test)]
    TEST_HOLD_ACTIVE.store(false, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(not(all(windows, not(feature = "test"))))]
fn apply_blocking() {
    #[cfg(test)]
    TEST_HOLD_ACTIVE.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(all(windows, not(feature = "test")))]
fn run_commands(commands: &[Vec<&str>]) {
    for args in commands {
        if !selective_fail_open::command_may_run(args) {
            tracing::error!("selective fail-open: refused a command that was not prefix-only");
            continue;
        }
        let Some((executable, rest)) = args.split_first() else {
            continue;
        };
        match std::process::Command::new(executable).args(rest).status() {
            Ok(status) if status.success() => {}
            Ok(status) => tracing::warn!("selective fail-open: command exited {status}"),
            Err(error) => tracing::warn!("selective fail-open: command did not start: {error}"),
        }
    }
}
