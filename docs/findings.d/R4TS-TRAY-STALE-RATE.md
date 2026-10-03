| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4TS-TRAY-STALE-RATE | Windows tray keeps showing the retained traffic sample as current /s rates after the controller feed becomes unavailable | fixed(3dcee213) | #1137 | 低·已确认（P3） | Display only; hidden-rate presentation (no placeholder) pending UI review |

`TrayPanel` ignored the `live` flag from `useTrafficData` (fixed in #1123); it now hides the rate claims when not live, matching `dashboard.tsx`.
