## 2026-09-26 · Does #331 (macOS bootstrap exception not bound to Tono) block the customer release?

- Status: owner
- Chosen: no. The customer release (0.0.74, see above) ships with H1-F5 (macOS half) as a
  known limitation in the release notes; #331 continues from plan v5 for 0.0.75. Rejected:
  holding the release for a helper/PF redesign rejected five times in plan review.
- Why: owner, 2026-09-26. Not a regression (present since 0.0.67); reach is limited to
  shared control-plane anycast addresses while Protected Offline.
