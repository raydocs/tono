//! H21-O-F8: the OS captive-portal verdict and the last attribution, for
//! [`tono_core::network_interference`].
//!
//! Read-only and unprivileged: one WinRT `NetworkInformation` read in the App
//! process, and only after a control-plane request has already failed. It is
//! the verdict Windows' own connectivity check (NCSI) reached; Tono sends no
//! probe of its own, armed or not. It changes no route, WFP filter or Service
//! state and is never part of the connect decision. A failed, stalled or
//! overlapping read means "no captive portal", never a guess.

use std::{
    sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
    },
    time::Duration,
};

use once_cell::sync::Lazy;
use tono_core::network_interference::{NetworkInterference, Observation};

/// A timeout cannot stop a native call; the permit stays with the blocking
/// worker so a stalled read never queues a second one behind it.
const READ_BUDGET: Duration = Duration::from_secs(2);
static READ_GATE: Lazy<Arc<tokio::sync::Semaphore>> = Lazy::new(|| Arc::new(tokio::sync::Semaphore::new(1)));

const NOTHING_SEEN: u8 = 0;
const CAPTIVE_PORTAL: u8 = 1;
const TLS_INTERCEPTED: u8 = 2;
/// What the last control-plane exchange that said anything about the network
/// said. An answer clears it; a failure that names nothing leaves it.
static LAST_OBSERVED: AtomicU8 = AtomicU8::new(NOTHING_SEEN);

/// Whether Windows reports the internet profile as behind a captive portal
/// (`ConstrainedInternetAccess`). False when the read is unavailable.
pub(crate) async fn os_reports_captive_portal() -> bool {
    let Ok(permit) = Arc::clone(&READ_GATE).try_acquire_owned() else {
        return false;
    };
    let read = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        read_captive_portal()
    });
    matches!(tokio::time::timeout(READ_BUDGET, read).await, Ok(Ok(true)))
}

/// Keep one exchange's attribution for the diagnostics report.
pub(crate) fn record(observation: Observation) {
    let value = match observation {
        Observation::Answered => NOTHING_SEEN,
        Observation::Interfered(NetworkInterference::CaptivePortal) => CAPTIVE_PORTAL,
        Observation::Interfered(NetworkInterference::TlsIntercepted) => TLS_INTERCEPTED,
        Observation::Unknown => return,
    };
    LAST_OBSERVED.store(value, Ordering::Relaxed);
}

/// The kept attribution, reported as a class token only.
pub(crate) fn last_observed() -> Option<NetworkInterference> {
    match LAST_OBSERVED.load(Ordering::Relaxed) {
        CAPTIVE_PORTAL => Some(NetworkInterference::CaptivePortal),
        TLS_INTERCEPTED => Some(NetworkInterference::TlsIntercepted),
        _ => None,
    }
}

#[cfg(all(windows, not(test)))]
fn read_captive_portal() -> bool {
    use windows::Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation};

    NetworkInformation::GetInternetConnectionProfile()
        .and_then(|profile| profile.GetNetworkConnectivityLevel())
        .is_ok_and(|level| level == NetworkConnectivityLevel::ConstrainedInternetAccess)
}

/// Off Windows there is no NLM verdict, and tests must not depend on the CI
/// machine's network.
#[cfg(any(not(windows), test))]
const fn read_captive_portal() -> bool {
    false
}
