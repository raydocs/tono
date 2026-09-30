| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-STALE-BEARER-401-SUSPENDS | macOS 同一账户续期后，旧 bearer 的迟到 401 可再次续期，决定性重放的传输重试随后误把被替换 bearer 的 401 当作当前会话拒绝，挂起健康账户并撤回出口 | in-PR | 待开 | 中·推导 | P2 多步竞态，未实机复现；新增 XCTest 未执行，无 Swift / Xcode，需 hosted macOS CI；同会话旧 bearer 的 403 / 2xx 判定不在本次范围 |

2026-09-30：`TonoAPIClient` 的身份代际不随同账户续期变化，四处 unauthorized 恢复原先无条件清空 access token；`sendData` 的传输重试继续发送已构造的旧 Authorization，决定性 401 又只校验身份代际。控制面续期会撤销前驱 SID，因此迟到拒绝可被绑定到新 refresh token 并送入账户挂起路径。

本分支在 401 会话报告及拒绝原因分类前检查请求 bearer：初次拒绝沿用现有恢复重放，决定性重放至多追加一次最新 bearer 重放，复用替代令牌；已有续期则等待它，不为旧拒绝新建续期。四处 unauthorized 恢复共用检查，只有仍为当前值的 bearer 才触发续期；已无令牌且无续期时照旧续期；追加重放再次被替换则按取消结束。`AccountSessionRequestTests` 用迟到 A/401（`USER_DISABLED`）、决定性 B 截断 200 / 传输重试及合法 B→C 续期覆盖同一竞态，验证健康账户不被挂起。不改 PF / DNS / 路由或 AI 阻断层；仅源码，无新候选。
