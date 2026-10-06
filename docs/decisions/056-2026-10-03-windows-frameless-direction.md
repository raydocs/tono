## 2026-10-03 · Windows frameless direction selected for later integration

- Status: provisional
- Chosen: the owner answered handoff section 7 question 4 by accepting visual frameless/full-bleed Windows chrome, with Windows-style controls at top right, not macOS traffic lights. Retain native drag, resize, double-click maximise, keyboard window controls and snap interactions; require real Windows qualification. Reject changing the native window or mounting the scene in PR 1.
- Why stricter: this records a design direction only, not permission to remove native interactions, weaken protection mapping, expand the tray or ship an untested custom title bar. Questions 1–3 and 5 remain pending before PR 2; no light-theme/navigation/protectedOffline decision is inferred.
- Applied in: draft PR #1375 documentation only, continuation of `b053c638`; [SHIP_PLAN](../SHIP_PLAN.md), deferred 0.0.75 UI work, not a G4 freeze exception. No native source, merge, deployment or package changes.
- Supersedes: only question 4's pending wording in [decision 055](055-2026-10-03-windows-sea-scene-preview.md). The original decision remains immutable historical scope; all other limits still apply.
