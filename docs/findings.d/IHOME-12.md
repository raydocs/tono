| ID | Issue | Status | Issue / PR | Severity | Remaining limits |
|---|---|---|---|---|---|
| IHOME-12 | Reused details cards are clipped in the two-column home sheet | fixed(bca5fa9a) | [#1393](https://github.com/raydocs/tono/pull/1393), [#1422](https://github.com/raydocs/tono/pull/1422) | 低·已确认 | #1422 restyles the reused cards inside the sheet (one 14px edge, page font, tabular figures, equal small tiles, latency in ms). Preview only; Windows not run. |

Current correction/verification: [H1–H12 evidence](../screenshots/sea-home-2026-10-05/review-corrections/README.md). The earlier functional scroll correction does not close the remaining cosmetic defect. Carried to PR4; not merged or Windows-qualified.

Owner re-check of819b8588 (2026-10-05): retain the working scroll area in PR2;
restyle the reused cards with PR4 shared components. No new PR2 card restyling.
[Latest receipt](../screenshots/sea-home-2026-10-05/recheck-819b8588/README.md).

#1422 (2026-10-06): the remaining cosmetic defect is addressed with class hooks on the reused cards and
overrides in `sea-home.css`; the cards themselves are unchanged outside the sheet. Checked in the shell preview
(920×600, zh and en), not on Windows/WebView2.
