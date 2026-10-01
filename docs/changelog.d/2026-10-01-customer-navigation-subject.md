## 2026-10-01 · Clear customer state when navigating to a different account
- Ownership: ops plan §2; customer management and billing correctness.
- Source: baseline `36a31ae7`; branch `hunt/sol-r4fcp-customer-subject`; fixes #1207. Source only; UI review required.
- Defect fix: navigating A→B could leave A's billing visible while reset usage wrote B. The customer page now remounts for each route customer ID, clearing reads, sticky data, forms and confirmations together.
- Added/optimized: none; same-customer refresh keeps its existing continuity, and no layout, styles or copy change.
- Engineering/tests: one actual-App navigation regression uses real resource, sticky, billing and confirmation/write hooks with external APIs and unrelated sections mocked. Before, the settled failed B read permitted a wrong-account reset; after, old content/actions are absent.
- Verification: Linux Node24; npm ci; focused App/CommandPalette2 tests; typecheck171/219; targeted eslint and diff check passed. Independent read-only review passed. Browser end-to-end checks run in CI; manual visual acceptance not run.
- Candidate/publication: source only; no deploy, publication or new candidate.
- Remaining limits: ui-review; auto-merge disabled. General resource hook behavior is unchanged; adjacent NodeDetail lacks the persistent sticky-action path.
