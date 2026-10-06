| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UNARMED-METRIC-WAKE | Windows 自动放行后的后台重连每次完整连接都整机拦截约 30–55 秒，同一上行仅 metric 变化就清零退避立即再试，前 10 分钟整机断网可达约 41–61% | fixed(e37e11b4) | [#1386](https://github.com/raydocs/tono/pull/1386) | 中·已确认 | 下限最长约 15.5 分钟（接近 310 秒事务上限的尝试），期间保护靠下一轮或手动连接恢复；换到可用的新网络也要等下限；单次尝试仍是完整验证，未减轮数；回归 `metric_wake_preserves_attempt_floor` 未在本机运行，占空比未实机测量 |

Codex `gpt-6.1-sol` max 核验 PARTIAL：链路确认；比例更正为每次 32.5 秒时前 600 秒 41.3%、52 秒时 60.7%；修法「下限」与「只比较首选上行」安全有条件。R4UB-WIN-FAILED-CONNECT-BACKOFF（fixed 520294ad）修的是 TCP 成功清零退避，当时有意保留 metric 唤醒；本条按[决策 063](../decisions/063-2026-10-05-unarmed-retry-attempt-floor.md)改变。

2026-10-06 合入续记：[#1386](https://github.com/raydocs/tono/pull/1386) 以 `e37e11b4` 合入 main；精确 PR head 的 [ci-gate 37427132996](https://github.com/raydocs/tono/actions/runs/37427132996) 成功，独立 high-risk 覆盖见 PR close-out 评论。`fixed` 仅表示源码合入，不表示实机验收或客户发布。
