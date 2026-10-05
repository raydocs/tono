| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| OPS-TODAY-FIRST-ACTION | ops2 桌面今天页把整块质量趋势排在事故操作前，手机为避开该顺序直接隐藏趋势 | fixed(933436cb) | [#1377](https://github.com/raydocs/tono/pull/1377) | 低·已确认 | 本分支已把处理区放前、趋势放后，并恢复手机趋势；已合 main 并部署；夹具浏览器验收非真实事故验证。 |

起始 `a97c963e` 的 `pages/today/HeroKpis.tsx` 间接在 hero 内挂载 QualityBand，并按 useIsPhone 隐藏。源码与桌面截图共同确认顺序；修后路径及截图见[改进报告](../ops/console-improvement-2026-10-04.md)。不改变事故判定、严重度或计数。
