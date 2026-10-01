## 2026-09-30 · Restore live node artifact modes after snapshot rollback
- Ownership: SHIP_PLAN §2 item 10 reliability fix; transactional provisioner recovery.
- Source: origin/main `d33399bb` → branch `hunt/sol-r3ops-rollback-file-mode`; not yet merged.
- Defect fix: snapshot hardening changed config mode 0640 to 0440; copying it back made metadata verification reject every ordinary extend rollback. Restore the recorded mode for non-symlink artifacts after copying their verified original bytes.
- New features/optimization: none; snapshot immutability, integrity checks, ownership and original service policy remain.
- Engineering/tests: narrow actual-backup/restore/verifier fixture fails before and passes after; separate symlink guard ensures the referent mode stays unchanged. Register both in Services CI.
- Verification: Linux Python fixture suite 2/2 passed after (1/2 failed before); bash syntax and diff checks passed. Independent fixture reproduced exact 0640→0440→0440 failure before editing.
- Candidate/publication: source only; no new candidate, host operation, deployment or publication.
- Remaining limits: no native VPS/systemd rollback acceptance; this fix does not address failures of the filesystem operations themselves.
