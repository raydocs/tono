| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| issue-4 | 计量从 legacy 切到 v2 时，静默窗口内 named 来源的增长被少计（1250 记成 1050） | accepted-design | [#4](https://github.com/raydocs/tono/issues/4)，[#196](https://github.com/raydocs/tono/pull/196) | 中·已确认 | 有损切换被拦住：`usage-metering.ts` 在存在 legacy 来源或 `legacy_last_seen_at > 0` 时报 `legacy_handoff_boundary_unavailable`，`POST phase=v2_required` 返回 409，迁移 0037 的触发器在 D1 里拒绝同一转换。要真正切换，需要先设计成对的 legacy 末次计费边界与 named 水位（切换协议），目前没有排期 |

2026-10-13 关闭 issue #4（所有者同意按记录关闭）：缺陷无法在生产发生，剩下的是未排期的切换协议功能，不是待修 bug。核对：origin/main `usage-metering.ts:60`、`migrations/0037_block_unpaired_legacy_cutover.sql`。
