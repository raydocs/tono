## 2026-09-30 · Retry DNS Apply before retiring recovery
- Ownership: SHIP_PLAN §2 item 10; macOS helper M3.
- Source: baseline `857b9e73`; branch `hunt/sol-r3helper-dns-apply-retry`; source-only PR, not yet merged.
- Bug fix: after DNS Commit succeeds and Apply fails, restore/handoff retry previously discarded the snapshot without applying active DNS. Both retries now invoke the normal writer again when persisted DNS matches saved originals; newer external choices remain untouched.
- New/optimized: none; service-ID ownership, original settings and PF/AI/strict policy remain unchanged.
- Engineering/tests: one narrow regression for restore and one for handoff use separate persisted/active resolver state and an injected first-Apply failure; helper protocol bumped and contract regenerated.
- Verification: Linux source/diff/record/contract checks; no Swift or native configd/DNS/PF execution. Existing macOS CI/hardware remain required.
- Candidate/publish: source only, no new package and no deployment/publication.
- Limits: Apply still converges asynchronously; this correction prevents retirement after a prior failed Apply, and does not replace native active-state proof.
