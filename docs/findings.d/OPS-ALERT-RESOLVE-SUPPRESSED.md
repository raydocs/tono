| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| OPS-ALERT-RESOLVE-SUPPRESSED | `fire_on=open_resolve` 告警规则的「恢复」投递在发送时总被标成 suppressed（`resolved before delay`），恢复消息从未发出 | in-PR | [#1510](https://github.com/raydocs/tono/pull/1510) | 低·已确认 | 生产现有规则都是 `fire_on=open`，所以此前没有漏发给所有者的恢复；修复只放行 resolve 投递，open / escalate 在延迟期内恢复仍被压。 |

`sendPending` 发送前查事故状态，已 resolved 就压掉投递；这条检查本意是「延迟期内已恢复的打开告警不再发」，但 resolve 投递
所属的事故必然已 resolved。A6 的 Worker 测试（`test/ops-verdict-run.test.ts`「alerts once on the third consecutive failed probe and
once on recovery」）在修复前于恢复处失败（期望 1 条，收到 0 条）。
