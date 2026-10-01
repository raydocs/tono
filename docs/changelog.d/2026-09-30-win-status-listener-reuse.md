## 2026-09-30 · Windows status listener reuse
- Ownership: SHIP_PLAN §2 item 10; Windows frontend status subscription lifecycle.
- Source: latest main `c32c087e` → branch `hunt/sol-winapp-shared-status-listener`; [PR #820](https://github.com/raydocs/tono/pull/820); not yet merged.
- Defect fix: a page mounting after the shared backend registration settled created another listener and leaked the previous one. Later subscribers now reuse the live listener; the last subscriber releases it.
- New features: none.
- Engineering/tests: the existing narrow subscription regression now mounts its second subscriber after registration settles.
- Verification: Linux Node 20 source-execution harness failed before the fix (`2 !== 1` registrations), then passed (one registration, one event per subscriber, one teardown); `git diff --check` passed. Pinned pnpm 11.26.0 installation cannot run on Node 20 (`node:sqlite` missing); Vitest/typecheck remain for hosted CI.
- Candidate/publication: source only; no new candidate or publication.
- Remaining limits: full frontend suite and native app tests not run locally.
