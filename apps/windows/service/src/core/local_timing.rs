//! Read-only timing of a local startup request, including rejected authentication.
//! Never a timeout, authorization cache or replacement for any protection step.
//! Nested spans overlap: compare siblings/queues, not the sum of every reported duration.

use std::{
    future::Future,
    sync::atomic::{AtomicU64, Ordering},
    time::Instant,
};

static NEXT_TRACE: AtomicU64 = AtomicU64::new(1);
tokio::task_local! { static TRACE: u64; }

#[derive(Clone, Debug)]
struct Sample {
    trace: u64,
    step: &'static str,
    elapsed_us: u64,
    outcome: &'static str,
}

struct Timer {
    trace: u64,
    step: &'static str,
    started: Instant,
    finished: bool,
}

impl Timer {
    fn current(step: &'static str) -> Option<Self> {
        TRACE
            .try_with(|trace| Self {
                trace: *trace,
                step,
                started: Instant::now(),
                finished: false,
            })
            .ok()
    }

    fn emit(&mut self, outcome: &'static str) {
        self.finished = true;
        let sample = Sample {
            trace: self.trace,
            step: self.step,
            elapsed_us: self
                .started
                .elapsed()
                .as_micros()
                .try_into()
                .unwrap_or(u64::MAX),
            outcome,
        };
        tracing::info!(target: "tono_local_start", trace_id = sample.trace, step = sample.step,
            source_fingerprint = crate::CONNECTION_SOURCE_FINGERPRINT,
            elapsed_us = sample.elapsed_us, outcome = sample.outcome, "local startup step");
        #[cfg(test)]
        let _ = TEST_SAMPLES.try_with(|samples| samples.lock().unwrap().push(sample));
    }
}

impl Drop for Timer {
    fn drop(&mut self) {
        if !self.finished {
            self.emit("interrupted");
        }
    }
}

/// Per-request identity is independent of owner/session/credentials. No extra IPC or state gate.
pub(super) async fn in_trace<T>(route: &'static str, future: impl Future<Output = T>) -> T {
    TRACE
        .scope(NEXT_TRACE.fetch_add(1, Ordering::Relaxed), async {
            returned(route, future).await
        })
        .await
}

/// For queues or HTTP responses: "returned" does NOT imply a successful nested Service verdict.
pub(super) async fn returned<T>(step: &'static str, future: impl Future<Output = T>) -> T {
    let mut timer = Timer::current(step);
    let output = future.await;
    if let Some(timer) = &mut timer {
        timer.emit("returned");
    }
    output
}

/// For actual subsystem results; never formats the error or payload (which may contain secrets).
pub(super) async fn result<T, E>(
    step: &'static str,
    future: impl Future<Output = Result<T, E>>,
) -> Result<T, E> {
    result_with_verdict(step, future, |_| true).await
}

/// An Ok(status) can still contain unproven native readback. Record the distinction without
/// changing the result or treating instrumentation as a new protection gate.
pub(super) async fn result_with_verdict<T, E>(
    step: &'static str,
    future: impl Future<Output = Result<T, E>>,
    proven: impl FnOnce(&T) -> bool,
) -> Result<T, E> {
    let mut timer = Timer::current(step);
    let output = future.await;
    if let Some(timer) = &mut timer {
        timer.emit(match &output {
            Ok(value) if proven(value) => "succeeded",
            Ok(_) => "unproven",
            Err(_) => "failed",
        });
    }
    output
}

#[cfg(test)]
tokio::task_local! { static TEST_SAMPLES: std::sync::Arc<std::sync::Mutex<Vec<Sample>>>; }

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn results_and_errors_are_unchanged_and_not_formatted_into_metrics() {
        struct PrivateError;
        let samples = Arc::new(Mutex::new(Vec::new()));
        TEST_SAMPLES
            .scope(
                samples.clone(),
                in_trace("start", async {
                    assert_eq!(returned("queue", async { 4 }).await, 4);
                    assert_eq!(
                        result("ok", async { Ok::<_, PrivateError>(7) }).await.ok(),
                        Some(7)
                    );
                    assert!(
                        result("failure", async { Err::<(), _>(PrivateError) })
                            .await
                            .is_err()
                    );
                }),
            )
            .await;
        let samples = samples.lock().unwrap();
        assert_eq!(
            samples
                .iter()
                .map(|v| (v.step, v.outcome))
                .collect::<Vec<_>>(),
            [
                ("queue", "returned"),
                ("ok", "succeeded"),
                ("failure", "failed"),
                ("start", "returned")
            ]
        );
        assert!(samples.iter().all(|v| v.trace == samples[0].trace));
    }

    #[tokio::test]
    async fn cancellation_is_not_reported_as_completion_or_shielded_by_timing() {
        struct Dropped(Arc<std::sync::atomic::AtomicBool>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                self.0.store(true, Ordering::Release);
            }
        }
        let dropped = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let samples = Arc::new(Mutex::new(Vec::new()));
        TEST_SAMPLES.scope(samples.clone(), async {
            let future = in_trace("start", result("native", async {
                let _drop = Dropped(dropped.clone());
                std::future::pending::<Result<(), ()>>().await
            }));
            tokio::select! { biased; _ = future => panic!("pending work returned"), _ = tokio::task::yield_now() => {} }
        }).await;
        assert!(dropped.load(Ordering::Acquire));
        let samples = samples.lock().unwrap();
        assert_eq!(samples.len(), 2);
        assert!(samples.iter().all(|v| v.outcome == "interrupted"));
    }

    #[tokio::test]
    async fn requests_have_distinct_ids_and_non_startup_calls_do_not_add_log_traffic() {
        let samples = Arc::new(Mutex::new(Vec::new()));
        TEST_SAMPLES
            .scope(samples.clone(), async {
                returned("not_traced", async {}).await;
                in_trace("first", async {}).await;
                in_trace("second", async {}).await;
            })
            .await;
        let samples = samples.lock().unwrap();
        assert_eq!(samples.len(), 2);
        assert_ne!(samples[0].trace, samples[1].trace);
    }

    #[tokio::test]
    async fn ok_reply_with_unproven_native_status_is_not_logged_as_proven() {
        let samples = Arc::new(Mutex::new(Vec::new()));
        TEST_SAMPLES
            .scope(
                samples.clone(),
                in_trace("start", async {
                    let result =
                        result_with_verdict("dns", async { Ok::<_, ()>(false) }, |ready| *ready)
                            .await;
                    assert_eq!(result, Ok(false));
                }),
            )
            .await;
        assert_eq!(samples.lock().unwrap()[0].outcome, "unproven");
    }

    #[test]
    fn startup_spans_keep_the_existing_security_and_readiness_calls() {
        let handlers = include_str!("server/handlers.rs");
        for route in [
            "prepare_core_start",
            "start_clash",
            "lock_kill_switch",
            "enable_protected_dns",
        ] {
            assert!(handlers.contains(&format!("local_timing::in_trace(\"{route}\"")));
        }
        for required in [
            "authenticate_request",
            "enter_owner_lifecycle",
            "require_active_session(&owner, &request.session)",
            "release_superseded(release_epoch)",
            "readiness::lock_when_ready(attempt)",
            "dns::enable()",
        ] {
            assert!(handlers.contains(required), "{required}");
        }
        let manager = include_str!("manager.rs");
        for required in [
            "self.prepare_start(true)",
            "retract_direct_before_core_replacement()",
            "secure_core_ipc_socket(",
            "write_runtime_record_for_config(child_pid, &config, \"after start\")",
        ] {
            assert!(manager.contains(required), "{required}");
        }
        let assets = include_str!("runtime_generation/assets.rs");
        assert!(assets.contains("runtime.validate_core_image"));
        assert!(assets.contains("super::core_integrity::verify_core_binary(&canonical)?"));
    }
}
