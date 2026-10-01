## 2026-10-01 · Durable selective macOS release
- Ownership: SHIP_PLAN §2 item 10; macOS helper recovery.
- Source: baseline `520294ad`; branch `hunt/sol-r4fma-release-ai-hold`, not merged at authoring.
- Bug fix: #1078. Persist the narrow AI disposition before removing broad intent; fresh helper startup resumes interrupted selective installation, while explicit Restore leaves a tombstone preventing replay. Automatic startup, watchdog, orphan and failed-commit paths use the same ordering.
- Added/optimized: no new destinations, suffixes, PF enable, or strict-mode change.
- Engineering/test: one root lifecycle regression writes the actual durable record, interrupts after broad intent removal, reads it anew, resumes AI installation, and verifies explicit release suppresses replay.
- Verification: Linux `git diff --check` and records parser. Swift/native failing and passing execution unavailable; hosted macOS CI required.
- Candidate/publication: source only, no new package or publication.
- Remaining limits: native PF/routes/DNS acceptance (`needs-hardware`); failed durable writes and native selective installation remain best-effort to preserve ordinary connectivity.
