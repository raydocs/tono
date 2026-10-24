| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WORKER-REFRESH-SECOND-REPLAY | 连续两次刷新响应丢失后原 refresh token 指向已撤销的中间 successor，恢复被误判401 | in-PR | [#1738](https://github.com/raydocs/tono/pull/1738) | 中·已确认（本地 D1 回归） | 原600秒窗口内重复恢复，不延长宽限；旧“第二次重放必须401”测试未改，安全交叉审查待编排者完成 |

基线 `429e23427` 的 `services/control-plane/src/sessions.ts:101-106` 仅解析一个 successor，tokens() 第一次 replay 撤销 S1 后未重指向 S0，第二次 T0 触发 `s.revoked_at !== null`。
修复 `sessions.ts:49-78,119,144`：原 root 与当前 successor 的 CAS、账户/设备与原窗口约束在 D1 batch 内检查，胜者原子重指向 root；中间 token 的 rotated_at 保持 NULL。只重指向本次成功恢复的 root，不穿越正常轮换或复活已撤销会话；无 migration。
真实 RED：测试 `f1da98c94` 配 `429e23427` 的 sessions.ts，3 failed/2 passed（两次200预期收到401，root未前进）；GREEN：`162f96549` 的新测试5 passed。
威胁模型和完整验证见 [T6验证续记](../reports/t6-control-plane-verification-2026-10-24.md#追加-worker-refresh-second-replay)。
