## 2026-10-01 · macOS selective cleanup retries after a failed removal
- Ownership: SHIP_PLAN §2 item 10; macOS helper selective fail-open recovery (#1169 follow-up).
- Source: baseline `5831e1ec`; branch `fix/selective-cleanup-released-retry`, PR #1283 fixes #1282, not yet merged.
- Defect fix: `removeBestEffort()` now reports whether every resolver was restored and every route delete finished. `releaseWithAIHold` and `reconcileSelectiveRecovery` write `released` only on success; otherwise the record stays `releasing` and `selectiveRecoveryReconciled` stays false, so the next start or 10 s watchdog pass retries. Previously a transient failure was logged, recorded as released and never retried, leaving the AI sinkhole/blackhole until another explicit Restore.
- New/optimization: none. Ordinary network release is unchanged; only the AI layer can stay longer.
- Engineering/tests: helper protocol 4.52.34 → 4.52.35, CONTRACT.sha256 recomputed. New `--lifecycle-self-test` case `runFailedSelectiveRemovalRetrySelfTest` (failed removal stays pending, the next reconcile finishes it); existing selective self-test closures return `true`.
- Verification: CONTRACT hash recomputed with the build-core-helper.sh manifest (script reproduced main's 4.52.34 hash first). No local Swift build or self-test (MacBook policy); hosted macOS CI runs the lifecycle self-test.
- Candidate/publication: source only; no new package.
- Limits: needs-hardware; a permanent cleanup failure retries and logs every 10 s while no Kill Switch intent is saved.
