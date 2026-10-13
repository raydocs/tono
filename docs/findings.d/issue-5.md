| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| issue-5 | home-agent 只按稳定 ID 与数值比较对端计数，计数器重置后超过旧水位时少计（应 2500 记成 1500） | open | [#5](https://github.com/raydocs/tono/issues/5)，[#196](https://github.com/raydocs/tono/pull/196) | 中·推导 | Tailscale status JSON 不导出计数器代际或退役对端累计，无法可靠区分；不得用 PID/启动时间等自造代际。`test_status_without_generation_cannot_distinguish_reset_above_watermark` 有意记录这个缺口。上游提供代际后再修 |

2026-10-13 关闭 issue #5（blocked-external，所有者同意按记录关闭）：缺陷仍在，跟踪以本行为准。
