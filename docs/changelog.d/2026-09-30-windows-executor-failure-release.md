## 2026-09-30 · Windows update executor failures reach selective recovery
- Ownership: SHIP_PLAN §2 item 10; update/install/rollback regression review.
- Source: baseline `7f382af7`; branch `hunt/sol-r4upd-win-register-release`; source PR, not merged when authored.
- Bug fix: recovery-task registration refusal and successor-launch/persistence failure now reach the existing non-strict selective-release finalizer before Service restart. Finding `R4UPD-WIN-EXECUTOR-FAILURE-RELEASE` (P1), missed sibling paths of #1042/#858/#978.
- New features: none; strict hold, successful updates, durable high-water, original failure and pending evidence retain their contracts.
- Engineering/tests: the finalizer accepts the actual executor outcome; one new regression verifies selective release before successful restart on an error, preserving strict mode. Existing call sites/tests pass the outcome explicitly.
- Verification: Linux exact-production finalizer extraction: baseline 0 passed/1 failed; fixed new and existing disposition regressions 2 passed/0 failed. Portable Service journal check is recorded in the PR. Native executor/SCM/WFP/NRPT cannot run on Linux and require hosted Windows CI plus hardware.
- Candidate/release: source only; no new package, deployment or publication.
- Limits: pre-consumption capture/receipt-write exits and interrupted durable rollback remain separate audit items; secondary cleanup failures and existing AI-layer coverage limits are unchanged.
