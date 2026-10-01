## 2026-09-30 · Complete durable local provisioning state after verified recovery
- Ownership: SHIP_PLAN §2 item 10 reliability; transactional node provisioning.
- Source: origin/main `c1f1561a` → branch `hunt/sol-r3ops-provision-pending-recovery`; not yet merged.
- Defect fix: remote provisioning could finish before a crash/final local-write failure; retry reported verified but never retired the pending state or recovered client metadata. Persist the normal completed record after fresh remote verification so enrollment can proceed.
- New features/optimization: none; no duplicate prepare/apply, remote mutation, automatic enrollment or publication. Completed-state retries and read-only verify semantics stay unchanged.
- Engineering/tests: one narrow Flow regression from durable pending intent through retry and private enrollment; register the existing Python provisioner suite and its paths in Services CI.
- Verification: regression failed before at persisted verified:false; after, Flow 8/8 passed, CI filter tests 7/7 and diff check passed. Full suite 20 passed, 1 environmental error because system OpenSSH is unavailable; no skip or relaxed test.
- Candidate/publication: source only; no new candidate, real host operation, deployment or publication.
- Remaining limits: actual crash/SSH/VPS recovery remains untested; persistent filesystem errors still reject completion and retain pending intent.

2026-09-30 continuation: [#1002](https://github.com/raydocs/tono/pull/1002) merged at main `156a2536f5dad0c56b809e9e4af9c7fbf5a3c75a`. Exact head `f734e04d228d6e8ecf9918a7db426a57321fa6eb` passed [ci-gate](https://github.com/raydocs/tono/actions/runs/36808591259/job/110211352629). Original fixture evidence remains tied to its tested source. No new candidate, real-host acceptance, deployment or publication.
