| ID | Issue | Status | Issue / PR | Severity | Remaining limits |
|---|---|---|---|---|---|
| IHOME-13 | Home line picker flips upward over the title at default window sizes | fixed(5a77c6b6) | [#1393](https://github.com/raydocs/tono/pull/1393) | 低·已确认 | MacBook browser only, Windows not run. |

Owner PR2-REVIEW, re-check of819b8588 (2026-10-05). R1: downward-first placement when below≥200px; upward only below<200px and above>below. Internal list scroll and collision clamp retained.

[Regressions, geometry and screenshots](../screenshots/sea-home-2026-10-05/recheck-819b8588/README.md).
Not fixed on main or hardware-qualified.
