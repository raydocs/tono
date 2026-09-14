//! Deciding when the Service has stopped being ours.
//!
//! While the Core runs under the Service, the app polls the Service for owner status. Three
//! things can go wrong — we cannot read a reply, the Service says someone else owns it, or it
//! answers but describes a Core that is gone — and each needs a different response. This is
//! the decision, separated from the polling and from the recovery it triggers.
//!
//! Recovery *actions* deliberately live with the Core lifecycle rather than here: this module
//! decides that the Service can no longer be trusted, and `CoreManager` is what tears the Core
//! down in response.

use tono_service_protocol::ServiceLifecycleState;

/// How many consecutive bad samples we tolerate before acting.
///
/// Service restarts and slow status calls are normal; acting on the first one would tear down
/// a working proxy for a blip.
const SUSTAINED_SAMPLES: u8 = 3;

/// Why the app stopped trusting the Service that was running its Core.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerRecoveryReason {
    /// Another owner took the Service over.
    Displaced,
    /// Still ours, but the Core it was running is gone.
    SameOwnerFailure,
    /// We could not reach the Service at all for long enough to give up.
    TransportFailure,
}

/// One reading of Service owner status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerSample {
    /// No usable answer: transport failed, an error code came back, or the payload was empty.
    Unreadable,
    /// The Service reports it is no longer running for us.
    NotActive,
    /// A complete answer.
    Status {
        is_active: bool,
        desired_core_should_be_running: bool,
        /// `true` when the Service could not read this owner's durable desired state for this
        /// sample, so `desired_core_should_be_running` is a placeholder rather than an
        /// observation. Such a sample must not be read as "the owner wants its core stopped":
        /// the read can fail transiently while the tunnel is perfectly healthy, so the client
        /// keeps what it already believes instead of tearing a healthy session down.
        desired_state_unknown: bool,
        service_state: ServiceLifecycleState,
        core_pid: Option<u32>,
    },
}

/// What the caller should do about a sample.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerStep {
    /// Nothing is wrong, or not wrong for long enough yet.
    Continue,
    /// Unreadable for long enough that it might be real. Check whether the Core's own endpoint
    /// still answers, then report back via [`OwnerWatch::resolve_transport`].
    ///
    /// A Service we cannot reach while the Core is still serving is a broken status channel,
    /// not a lost Core — tearing down the proxy there would be the cure causing the disease.
    VerifyTransport,
    /// Stop trusting the Service and recover.
    Recover(OwnerRecoveryReason),
}

/// Counts consecutive bad samples so that a blip is not mistaken for a failure.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct OwnerWatch {
    unreadable_samples: u8,
    missing_core_samples: u8,
    displaced_samples: u8,
}

impl OwnerWatch {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            unreadable_samples: 0,
            missing_core_samples: 0,
            displaced_samples: 0,
        }
    }

    /// Whether this sample warrants a log line: only the moment a run becomes sustained, so a
    /// permanently broken Service does not fill the log at the poll interval.
    #[must_use]
    pub const fn just_became_sustained(&self) -> bool {
        self.unreadable_samples == SUSTAINED_SAMPLES
    }

    /// Fold one reading into the decision.
    pub const fn observe(&mut self, sample: OwnerSample) -> OwnerStep {
        match sample {
            OwnerSample::Unreadable => {
                self.unreadable_samples = self.unreadable_samples.saturating_add(1);
                if self.unreadable_samples >= SUSTAINED_SAMPLES {
                    OwnerStep::VerifyTransport
                } else {
                    OwnerStep::Continue
                }
            }
            // Debounced like every other bad reading, and for the same reason: displacement is
            // indistinguishable from a *deliberate* session handoff. `tono_start_core_with_kill_switch`
            // clears the active session before issuing StartClash and only repopulates it after
            // the reply, so a monitor from the previous start ticking inside that window reads a
            // perfectly successful status as "someone else owns this" and tears the proxy down
            // while our own second StartClash is in flight — which every connect carrying a
            // cloud policy passes through twice. The handoff now also cancels the monitor; this
            // is the belt to that braces.
            OwnerSample::NotActive => {
                self.unreadable_samples = 0;
                self.displaced_samples = self.displaced_samples.saturating_add(1);
                if self.displaced_samples >= SUSTAINED_SAMPLES {
                    OwnerStep::Recover(OwnerRecoveryReason::Displaced)
                } else {
                    OwnerStep::Continue
                }
            }
            OwnerSample::Status {
                is_active,
                desired_core_should_be_running,
                desired_state_unknown,
                service_state,
                core_pid,
            } => {
                self.unreadable_samples = 0;
                self.missing_core_samples = if core_pid.is_none() && !is_settling(service_state) {
                    self.missing_core_samples.saturating_add(1)
                } else {
                    0
                };
                // An answer that says we *are* active is the contradiction that clears the run.
                self.displaced_samples = if is_active {
                    0
                } else {
                    self.displaced_samples.saturating_add(1)
                };
                match recovery_reason(
                    is_active,
                    desired_core_should_be_running,
                    desired_state_unknown,
                    service_state,
                    core_pid,
                    self.missing_core_samples,
                    self.displaced_samples,
                ) {
                    Some(reason) => OwnerStep::Recover(reason),
                    None => OwnerStep::Continue,
                }
            }
        }
    }

    /// Report what the transport check found after [`OwnerStep::VerifyTransport`].
    ///
    /// If the Core's own endpoint still answers, only the status channel is broken: the run is
    /// reset so the next stretch of silence has to earn its own verdict.
    pub const fn resolve_transport(&mut self, owner_endpoint_available: bool) -> OwnerStep {
        if owner_endpoint_available {
            self.unreadable_samples = 0;
            return OwnerStep::Continue;
        }
        OwnerStep::Recover(OwnerRecoveryReason::TransportFailure)
    }
}

/// States in which a missing Core PID is expected rather than alarming.
const fn is_settling(service_state: ServiceLifecycleState) -> bool {
    matches!(
        service_state,
        ServiceLifecycleState::Starting | ServiceLifecycleState::RecoveringCore
    )
}

const fn recovery_reason(
    is_active: bool,
    desired_running: bool,
    desired_unknown: bool,
    service_state: ServiceLifecycleState,
    core_pid: Option<u32>,
    missing_core_samples: u8,
    displaced_samples: u8,
) -> Option<OwnerRecoveryReason> {
    if !is_active {
        // Same debounce as the `NotActive` sample: the Service reports us inactive for the whole
        // of a deliberate session handoff, and acting on the first one tears down our own start.
        if displaced_samples >= SUSTAINED_SAMPLES {
            return Some(OwnerRecoveryReason::Displaced);
        }
        return None;
    }
    let core_is_gone = !is_settling(service_state) && core_pid.is_none() && missing_core_samples >= SUSTAINED_SAMPLES;
    // A desired state the Service could not read is not a deliberate stop: the read fails
    // transiently while the tunnel is healthy, and one such sample — out of a poll every two
    // seconds — used to tear a healthy session down. Gate only the `!desired_running` arm;
    // `Fatal` and a genuinely gone core still recover as before, so an unknown read cannot hide
    // either one.
    if (!desired_running && !desired_unknown) || matches!(service_state, ServiceLifecycleState::Fatal) || core_is_gone {
        return Some(OwnerRecoveryReason::SameOwnerFailure);
    }
    None
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, reason = "tests assert by panicking")]
mod tests {
    use super::*;

    const fn healthy() -> OwnerSample {
        OwnerSample::Status {
            is_active: true,
            desired_core_should_be_running: true,
            desired_state_unknown: false,
            service_state: ServiceLifecycleState::Running,
            core_pid: Some(42),
        }
    }

    const fn core_gone(service_state: ServiceLifecycleState) -> OwnerSample {
        OwnerSample::Status {
            is_active: true,
            desired_core_should_be_running: true,
            desired_state_unknown: false,
            service_state,
            core_pid: None,
        }
    }

    #[test]
    fn a_healthy_sample_changes_nothing() {
        let mut watch = OwnerWatch::new();
        assert_eq!(watch.observe(healthy()), OwnerStep::Continue);
        assert_eq!(watch, OwnerWatch::new());
    }

    #[test]
    fn a_short_run_of_unreadable_samples_is_tolerated() {
        let mut watch = OwnerWatch::new();
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
    }

    #[test]
    fn a_sustained_run_of_unreadable_samples_asks_about_the_transport() {
        let mut watch = OwnerWatch::new();
        for _ in 0..2 {
            watch.observe(OwnerSample::Unreadable);
        }
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::VerifyTransport);
        assert!(watch.just_became_sustained(), "the sustained moment should log once");
    }

    #[test]
    fn a_sustained_run_logs_only_once_however_long_it_lasts() {
        let mut watch = OwnerWatch::new();
        for _ in 0..3 {
            watch.observe(OwnerSample::Unreadable);
        }
        assert!(watch.just_became_sustained());

        watch.observe(OwnerSample::Unreadable);
        assert!(!watch.just_became_sustained());
    }

    #[test]
    fn a_reachable_core_endpoint_means_only_the_status_channel_broke() {
        let mut watch = OwnerWatch::new();
        for _ in 0..3 {
            watch.observe(OwnerSample::Unreadable);
        }

        assert_eq!(watch.resolve_transport(true), OwnerStep::Continue);

        // The run restarted: the next stretch of silence must earn its own verdict.
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::VerifyTransport);
    }

    #[test]
    fn an_unreachable_core_endpoint_confirms_transport_failure() {
        let mut watch = OwnerWatch::new();
        for _ in 0..3 {
            watch.observe(OwnerSample::Unreadable);
        }

        assert_eq!(
            watch.resolve_transport(false),
            OwnerStep::Recover(OwnerRecoveryReason::TransportFailure)
        );
    }

    #[test]
    fn a_readable_sample_clears_an_unreadable_run() {
        let mut watch = OwnerWatch::new();
        watch.observe(OwnerSample::Unreadable);
        watch.observe(OwnerSample::Unreadable);

        watch.observe(healthy());

        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
    }

    #[test]
    fn a_not_active_sample_breaks_an_unreadable_run() {
        // `NotActive` is a readable Service reply, so it must clear the unreadable run just as
        // a `Status` reply does. Without the reset in the `NotActive` arm, the sequence
        // Unreadable, Unreadable, NotActive, Unreadable, Unreadable would reach
        // `unreadable_samples == 3` on a single consecutive unreadable sample and fire a
        // spurious `VerifyTransport`.
        let mut watch = OwnerWatch::new();
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
        assert_eq!(watch.observe(OwnerSample::NotActive), OwnerStep::Continue);

        // The run restarted at the NotActive sample: only a fresh stretch of three
        // consecutive unreadable samples may ask about the transport again.
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::Continue);
        assert_eq!(watch.observe(OwnerSample::Unreadable), OwnerStep::VerifyTransport);
    }

    const fn not_the_owner() -> OwnerSample {
        OwnerSample::Status {
            is_active: false,
            desired_core_should_be_running: true,
            desired_state_unknown: false,
            service_state: ServiceLifecycleState::Running,
            core_pid: Some(1),
        }
    }

    #[test]
    fn a_sustained_run_of_not_active_is_displacement() {
        let mut watch = OwnerWatch::new();
        // A single sample is our own session handoff far more often than it is displacement.
        assert_eq!(watch.observe(OwnerSample::NotActive), OwnerStep::Continue);
        assert_eq!(watch.observe(OwnerSample::NotActive), OwnerStep::Continue);
        assert_eq!(
            watch.observe(OwnerSample::NotActive),
            OwnerStep::Recover(OwnerRecoveryReason::Displaced)
        );
    }

    #[test]
    fn a_sustained_run_of_statuses_disowning_us_is_displacement() {
        let mut watch = OwnerWatch::new();
        assert_eq!(watch.observe(not_the_owner()), OwnerStep::Continue);
        assert_eq!(watch.observe(not_the_owner()), OwnerStep::Continue);
        assert_eq!(
            watch.observe(not_the_owner()),
            OwnerStep::Recover(OwnerRecoveryReason::Displaced)
        );
    }

    #[test]
    fn a_session_handoff_window_does_not_tear_down_our_own_start() {
        // The shape of `tono_start_core_with_kill_switch`: the session is cleared, one or two
        // ticks land inside the window, then the new session is adopted and status is ours again.
        let mut watch = OwnerWatch::new();
        assert_eq!(watch.observe(OwnerSample::NotActive), OwnerStep::Continue);
        assert_eq!(watch.observe(not_the_owner()), OwnerStep::Continue);
        assert_eq!(watch.observe(healthy()), OwnerStep::Continue);
        // ...and the run has to start over afterwards.
        assert_eq!(watch.observe(OwnerSample::NotActive), OwnerStep::Continue);
        assert_eq!(watch.observe(OwnerSample::NotActive), OwnerStep::Continue);
    }

    #[test]
    fn a_fatal_service_recovers_immediately() {
        let mut watch = OwnerWatch::new();
        let sample = OwnerSample::Status {
            is_active: true,
            desired_core_should_be_running: true,
            desired_state_unknown: false,
            service_state: ServiceLifecycleState::Fatal,
            core_pid: Some(1),
        };
        assert_eq!(
            watch.observe(sample),
            OwnerStep::Recover(OwnerRecoveryReason::SameOwnerFailure)
        );
    }

    #[test]
    fn a_service_that_no_longer_wants_the_core_running_recovers_immediately() {
        let mut watch = OwnerWatch::new();
        let sample = OwnerSample::Status {
            is_active: true,
            desired_core_should_be_running: false,
            desired_state_unknown: false,
            service_state: ServiceLifecycleState::Running,
            core_pid: Some(1),
        };
        assert_eq!(
            watch.observe(sample),
            OwnerStep::Recover(OwnerRecoveryReason::SameOwnerFailure)
        );
    }

    // A failed desired-state read is the one `Status` sample the Service intentionally publishes
    // with `desired_core_should_be_running = false` that is *not* a deliberate stop. The whole
    // point of `desired_state_unknown` is that such a sample must never tear a healthy session
    // down, and `recovery_reason` must only let the `!desired_running` arm fire when the read
    // actually succeeded.

    const fn transient_desired_read_failure(service_state: ServiceLifecycleState) -> OwnerSample {
        OwnerSample::Status {
            is_active: true,
            desired_core_should_be_running: false,
            desired_state_unknown: true,
            service_state,
            core_pid: Some(1),
        }
    }

    #[test]
    fn a_transient_desired_state_read_failure_preserves_a_healthy_session() {
        // The Service could not read `desired-state.json` for one poll but the active owner and
        // core are healthy — the very first such sample used to tear the session down.
        let mut watch = OwnerWatch::new();
        assert_eq!(
            watch.observe(transient_desired_read_failure(ServiceLifecycleState::Running)),
            OwnerStep::Continue
        );
    }

    #[test]
    fn a_sustained_transient_desired_state_read_failure_keeps_the_session_alive() {
        // The desired read can stay unreadable for many polls while the core keeps running; it
        // must never be promoted to a recovery.
        let mut watch = OwnerWatch::new();
        let sample = transient_desired_read_failure(ServiceLifecycleState::Running);
        for _ in 0..10 {
            assert_eq!(watch.observe(sample), OwnerStep::Continue);
        }
        // The watch stays clean: nothing accumulated toward any recovery.
        assert_eq!(watch, OwnerWatch::new());
    }

    #[test]
    fn an_unknown_desired_state_does_not_mask_a_fatal_core() {
        // `effective_service_state` passes a Fatal core through even when the desired state is
        // unknown; the App must recover immediately — the flag gates only the deliberate stop.
        let mut watch = OwnerWatch::new();
        assert_eq!(
            watch.observe(transient_desired_read_failure(ServiceLifecycleState::Fatal)),
            OwnerStep::Recover(OwnerRecoveryReason::SameOwnerFailure)
        );
    }

    #[test]
    fn an_unknown_desired_state_does_not_mask_a_gone_core() {
        // If the core actually disappears while the desired read stays unreadable, the existing
        // `core_is_gone` debounce must still fire after `SUSTAINED_SAMPLES`.
        let mut watch = OwnerWatch::new();
        let gone = OwnerSample::Status {
            is_active: true,
            desired_core_should_be_running: false,
            desired_state_unknown: true,
            service_state: ServiceLifecycleState::Running,
            core_pid: None,
        };
        assert_eq!(watch.observe(gone), OwnerStep::Continue);
        assert_eq!(watch.observe(gone), OwnerStep::Continue);
        assert_eq!(
            watch.observe(gone),
            OwnerStep::Recover(OwnerRecoveryReason::SameOwnerFailure)
        );
    }

    #[test]
    fn a_settling_core_with_an_unknown_desired_state_is_tolerated() {
        // While the core is still Starting/RecoveringCore a missing PID is expected, and an
        // unknown desired state must not turn a healthy startup into a teardown.
        for state in [ServiceLifecycleState::Starting, ServiceLifecycleState::RecoveringCore] {
            let mut watch = OwnerWatch::new();
            let settling = OwnerSample::Status {
                is_active: true,
                desired_core_should_be_running: false,
                desired_state_unknown: true,
                service_state: state,
                core_pid: None,
            };
            for _ in 0..10 {
                assert_eq!(watch.observe(settling), OwnerStep::Continue, "{state:?}");
            }
        }
    }

    #[test]
    fn a_deliberate_stop_after_an_unknown_run_recovers_immediately() {
        // The owner really issued a stop: `desired_state_unknown = false` with
        // `desired_core_should_be_running = false`. A preceding run of unknown samples must not
        // keep the session alive past a genuine stop — the whole point is to preserve the session
        // only while the desired intent is genuinely unknown.
        let mut watch = OwnerWatch::new();
        let unknown = transient_desired_read_failure(ServiceLifecycleState::Running);
        let deliberate_stop = OwnerSample::Status {
            is_active: true,
            desired_core_should_be_running: false,
            desired_state_unknown: false,
            service_state: ServiceLifecycleState::Running,
            core_pid: Some(1),
        };
        watch.observe(unknown);
        watch.observe(unknown);
        assert_eq!(
            watch.observe(deliberate_stop),
            OwnerStep::Recover(OwnerRecoveryReason::SameOwnerFailure)
        );
    }

    #[test]
    fn a_healthy_sample_after_an_unknown_run_returns_to_clean() {
        // The desired read succeeds again and wants the core running: the watch must read it as
        // an ordinary healthy sample, and a subsequent single blip is still tolerated.
        let mut watch = OwnerWatch::new();
        let unknown = transient_desired_read_failure(ServiceLifecycleState::Running);
        watch.observe(unknown);
        watch.observe(unknown);
        assert_eq!(watch.observe(healthy()), OwnerStep::Continue);
        assert_eq!(watch.observe(unknown), OwnerStep::Continue);
    }

    #[test]
    fn a_briefly_missing_core_is_tolerated_then_recovered() {
        let mut watch = OwnerWatch::new();
        assert_eq!(
            watch.observe(core_gone(ServiceLifecycleState::Running)),
            OwnerStep::Continue
        );
        assert_eq!(
            watch.observe(core_gone(ServiceLifecycleState::Running)),
            OwnerStep::Continue
        );
        assert_eq!(
            watch.observe(core_gone(ServiceLifecycleState::Running)),
            OwnerStep::Recover(OwnerRecoveryReason::SameOwnerFailure)
        );
    }

    #[test]
    fn a_missing_core_is_expected_while_the_service_is_still_settling() {
        for state in [ServiceLifecycleState::Starting, ServiceLifecycleState::RecoveringCore] {
            let mut watch = OwnerWatch::new();
            for _ in 0..10 {
                assert_eq!(watch.observe(core_gone(state)), OwnerStep::Continue, "{state:?}");
            }
        }
    }

    #[test]
    fn a_core_that_comes_back_clears_the_missing_run() {
        let mut watch = OwnerWatch::new();
        watch.observe(core_gone(ServiceLifecycleState::Running));
        watch.observe(core_gone(ServiceLifecycleState::Running));

        watch.observe(healthy());

        assert_eq!(
            watch.observe(core_gone(ServiceLifecycleState::Running)),
            OwnerStep::Continue
        );
        assert_eq!(
            watch.observe(core_gone(ServiceLifecycleState::Running)),
            OwnerStep::Continue
        );
    }

    #[test]
    fn an_unreadable_run_does_not_count_towards_a_missing_core() {
        // The two counters are independent: silence says nothing about the Core's PID.
        let mut watch = OwnerWatch::new();
        watch.observe(OwnerSample::Unreadable);
        watch.observe(OwnerSample::Unreadable);

        assert_eq!(
            watch.observe(core_gone(ServiceLifecycleState::Running)),
            OwnerStep::Continue
        );
    }

    #[test]
    fn a_not_active_sample_does_not_reset_a_missing_core_run() {
        // `NotActive` carries no Core PID, so the fix that clears the unreadable run must NOT
        // also clear the missing-core run. Here two missing-core samples are followed by a
        // `NotActive`, then a third missing-core sample: the run must escalate exactly as it
        // would without the `NotActive`.
        let mut watch = OwnerWatch::new();
        assert_eq!(
            watch.observe(core_gone(ServiceLifecycleState::Running)),
            OwnerStep::Continue
        );
        assert_eq!(
            watch.observe(core_gone(ServiceLifecycleState::Running)),
            OwnerStep::Continue
        );
        assert_eq!(watch.observe(OwnerSample::NotActive), OwnerStep::Continue);
        assert_eq!(
            watch.observe(core_gone(ServiceLifecycleState::Running)),
            OwnerStep::Recover(OwnerRecoveryReason::SameOwnerFailure)
        );
    }
}
