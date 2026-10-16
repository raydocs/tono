## 2026-10-13 · Windows：凭据保险库停滞时，超时的授权 flush 不再填满写队列
- 归属：SHIP_PLAN §2 item 10；Windows App 凭据层（`apps/windows/app/src-tauri/src/tono/credentials.rs`）。
- 来源：基线 origin/main → 分支 `claude/win-grant-flush-queue`；Refs #1056（WIN-GRANT-FLUSH-QUEUE）；无需产品决定。
- 缺陷修复：每次目录同步用 2 s 超时调用 `credentials.flush()`，超时的调用方放弃等待，但它的 flush 屏障仍留在 64 槽的保险库写队列里；保险库长时间停滞时，反复同步把队列填满，下一次令牌轮换的 `try_send` 被拒（"queue full"），轮换失败的影响超过停滞本身的恢复。改后：同一段写入之间的所有 flush 共享一个排队屏障（`flush_tail`，弱引用，写入后清空；worker 完成屏障后先清再通知），两次写入之间没有新写入的 flush 共用一个屏障（64 个槽仍由写入和屏障共享，flush / 写入 / flush 交错时每段各占一个屏障）；满队列时 flush 仍等待空位（`reserve`），放弃的调用方不留下任何排队项。flush 的确认语义不变：屏障之前的所有写入已确认或失败后重试一次。
- 新增/优化：无。
- 工程与测试：`timed_out_flushes_do_not_fill_the_writer_queue_during_a_vault_stall`。
- 验证：见 PR 正文 `## Verification`。
- 候选/发布：仅源码，无新候选。
- 剩余限制：停滞期间每次令牌轮换仍各占一个队列槽（上限 64，未改）。
