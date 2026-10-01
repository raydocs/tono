| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CR4459-codex-F4 | 名册为空且无实时列表、无记录时，提前返回把已确认的 `shared-legacy` 撤除计数重置为 0（TF-opus-6 计数修复的遗漏） | fixed(50c2c0d0) | [#600](https://github.com/raydocs/tono/issues/600)，[#641](https://github.com/raydocs/tono/pull/641) | 低·已确认 | 仅日志；提前返回仍不撤除其他客户端；已部署 13 个装 agent 的节点（Tokyo·Sakura 未部署） |

来源：合并回归审查（区间 `f2e24512...fb5e8485`，jev-route run `4459fadd`）的 codex:F4，Opus 复核确认。
