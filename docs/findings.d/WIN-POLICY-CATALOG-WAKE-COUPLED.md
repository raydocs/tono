| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-POLICY-CATALOG-WAKE-COUPLED | 策略同步时间戳不能独立唤醒周期任务，短目录重试成功后可将到期策略拖到下一目录 tick，普通 tick 也可提前重取策略 | in-PR | [#1379](https://github.com/raydocs/tono/pull/1379) | 低·推导 | 同一任务分别等待目录与策略期限；已加 paused-clock 回归，hosted CI 与窄复审待完成；未实机验证 |

Codex gpt-6.1-sol high 补审 60c0b077...9f9fe41c 发现 minor；例如 t=285 短重试成功后，策略本应 t=300 到期但目录下一 tick 是 t=585。无泄漏、权限或保护释放变化。
