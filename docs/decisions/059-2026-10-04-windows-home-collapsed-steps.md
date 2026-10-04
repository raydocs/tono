## 2026-10-04 · Collapse clean connection steps on the opt-in home

- Status: provisional
- Chosen: the clean connection step list behind a disclosure; open on an error or retry; preserve a visible list if existing regression tests require it.
- Owner direction: 2026-10-04, "按你推荐的来", accepting the recommendation in ROUND-2 B5. Recorded from the owner-supplied `handoff-2026-10-03-ui/ROUND-2.md`; this is an owner-selected direction, not an agent-invented default. The record status follows the repository rule that only the owner sets `owner`.
- Why stricter: All progress, error, retry and protection actions remain owned by the existing ConnectProgressCard. No safety condition or handler is hidden or reimplemented.
- Applied in: direction recorded in draft PR #1375; implementation belongs to later draft PR 2 (home) and PR 3 (top bar/frameless), under [SHIP_PLAN](../SHIP_PLAN.md), deferred 0.0.75 UI work. No app or native window change in PR 1. No automatic merge; final hardware acceptance belongs to the owner.
