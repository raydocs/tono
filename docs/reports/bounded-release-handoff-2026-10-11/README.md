# Bounded-release handoff package (2026-10-11)

This package is self-contained and readable without Amp. It covers the macOS one-click release ("恢复正常网络"), which must be
bounded and read back. That release blocks Tono 0.0.75 test packages.

| File | What it is |
|---|---|
| [HANDOFF.md](HANDOFF.md) | The owner's design handoff (via Puck), saved verbatim: requirements, failed designs, questions for an independent designer, the required test scenarios |
| [STATUS.md](STATUS.md) | Status at about 09:30 UTC on 2026-10-11: merged PRs with exact SHAs, the unmerged A13 #1504 head, CI and review receipts, design rounds and their failures, the budget, open issues, freeze/package state, device-only gates, screenshot sources, owners |

Read first:
- The live PR: [#1504](https://github.com/raydocs/tono/pull/1504). Its newest head and comments override any checkpoint here.
- Decision 094 (fence, drain cap and the (c) design) on the A13 branch:
  [094 at f7c8164f](https://github.com/raydocs/tono/blob/f7c8164fcf846c863cf44eb8ae0bd0aa98e087f2/docs/decisions/094-2026-10-11-user-release-fence-and-drain-cap.md).
- Project rules: [AGENTS.md](../../../AGENTS.md), [SHIP_PLAN](../../SHIP_PLAN.md), [owner checklist](../../ops/release-0075-owner-g1-g2-checklist.md).

Plain status:
- **Not release-ready.**
- The bounded one-click release (c) has failed three design reviews.
- No SHA is frozen and no signed candidate exists.
- Every device gate is pending.
- The Windows failed-Prepare A/B choice is pending the owner.
- The owner chose to wait for (c) before any test packages (Option 2).
