## 2026-09-30 · Keep helper requests responsive during DNS lock contention
- Ownership: SHIP_PLAN §2 item 10; macOS helper M3.
- Source: baseline `72a9c98d`; branch `hunt/sol-r3helper-dns-prefs-contention`; source-only PR, not yet merged.
- Bug fix: a paused or hung network-preferences writer previously held DNS restore, helper IPC/watchdog and the update lock indefinitely. DNS writes now refuse contention promptly and retain the recovery snapshot for retry.
- New/optimized: none; DNS ownership/readback and network-release predicates are unchanged.
- Engineering/tests: root lifecycle regression holds a real isolated preferences lock and requires the production acquisition to refuse it before the owner unlocks; helper protocol bumped and contract hash regenerated.
- Verification: Linux diff, record-format and contract checks only; no Swift, native preferences or PF/DNS execution. Existing macOS privileged CI runs the new regression.
- Candidate/publish: source only, no new package and no deployment/publication.
- Limits: system-framework startup/create/commit/apply calls and uninterruptible kernel operations can still stall; this fixes external lock contention only.
