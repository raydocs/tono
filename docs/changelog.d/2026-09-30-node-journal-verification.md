## 2026-09-30 · Verify node journal records without informational-banner failures
- Ownership: SHIP_PLAN §2 item 10 reliability fix; transactional node provisioner.
- Source: origin/main `b6c897c0` → branch `hunt/sol-r3ops-journal-verification`; not yet merged.
- Defect fix: an empty recent error journal printed an informational banner that rejected healthy restart verification; a failed query could conversely pass. Quietly capture journal output, require the query to succeed, and reject actual records.
- New features/optimization: none; listener, artifact, account, pressure and network-counter checks retain their admission rules.
- Engineering/tests: register three narrow fixture regressions in Services CI; real verify functions run with local transaction files and stubbed read-only host evidence.
- Verification: Linux regressions failed before (2 failures / 3), passed after (3 / 3); bash syntax and diff checks passed. Existing Python provisioner suite: 19 passed, 1 environmental error because system OpenSSH is unavailable. No tests skipped or relaxed.
- Candidate/publication: source only, no new candidate, deployment or host operation.
- Remaining limits: native journalctl/systemd/VPS verification not runnable in this VM; source semantics checked against systemd v252.
