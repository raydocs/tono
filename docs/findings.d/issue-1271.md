| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| issue-1271 | Windows 自动（非严格）放行先删掉全部 WFP 过滤器，再请求 AI 拦截（netsh 防火墙规则 + NRPT），两者之间 AI 流量可直连；拦截装失败只记日志 | in-PR | [#1271](https://github.com/raydocs/tono/issues/1271) | 中·推导（P2，仅 AI，亚秒窗口） | 每条自动放行在删 WFP 前先装并确认 AI 拦截；装失败或超时仍删 WFP（网络必须恢复），错误写日志和 last_error。严格模式与显式 Restore/Disconnect 不变。需实机验证 |

Codex (gpt-6.1-sol, high) review of #1266 found it; pre-existing on main for every crash / watchdog / startup release.
