## 2026-09-30 · Complete durable local provisioning state after verified recovery
- Ownership: SHIP_PLAN §2 item 10 reliability; transactional node provisioning.
- Source: origin/main `c1f1561a` → branch `hunt/sol-r3ops-provision-pending-recovery`; not yet merged.
- Defect fix: remote provisioning could finish before a crash/final local-write failure; retry reported verified but never retired the pending state or recovered client metadata. Persist the normal completed record after fresh remote verification so enrollment can proceed.
- New features/optimization: none; no duplicate prepare/apply, remote mutation, automatic enrollment or publication. Completed-state retries and read-only verify semantics stay unchanged.
- Engineering/tests: one narrow Flow regression from durable pending intent through retry and private enrollment; register the existing Python provisioner suite and its paths in Services CI.
- Verification: regression failed before at persisted verified:false; after, Flow 8/8 passed, CI filter tests 7/7 and diff check passed. Full suite 20 passed, 1 environmental error because system OpenSSH is unavailable; no skip or relaxed test.
- Candidate/publication: source only; no new candidate, real host operation, deployment or publication.
- Remaining limits: actual crash/SSH/VPS recovery remains untested; persistent filesystem errors still reject completion and retain pending intent.
