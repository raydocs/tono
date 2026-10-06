| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DNS-SNAPSHOT-LATE-DELETE | Windows 取消后的 DNS 快照按路径删除仍在 blocking 线程里迟到执行，后继 enable 写到同一路径的新快照可能被删 | fixed(574debe1) | [#1395](https://github.com/raydocs/tono/pull/1395) | 中·推导 | 删除线程持有独立锁 `SNAPSHOT_DELETE` 到删除返回，enable/restore 读快照前最多等 5 秒，超时失败关闭；删除真卡住时其后每次 DNS 操作都要等 5 秒再失败；卸载隔离改名未加等待；回归 `dropped_restore_delete_spares_successor_snapshot` 只在 hosted CI 运行（由钩子驱动时序） |

Codex 核验 PARTIAL：后继快照可与旧快照字节相同，延后再比摘要仍可能删掉新快照。WIN-DNS-SNAPSHOT-DELETE-BLOCKS、WIN-DNS-RETIRED-SNAPSHOT-REPLAY 是相关的不同机制。记录于 #1386。

2026-10-05 三轮：没有采用按句柄删除（需要本机无法编译的 Win32 调用），改为让迟到的删除与后继快照写入串行：删除线程持锁到删除返回，后继有界等待。见 [changelog](../changelog.d/2026-10-05-connection-audit-fixes-r2.md)，#1395。Codex 复审的测试 minor：删除已返回改由独立钩子证明（不靠被测的锁）；panic 路径不复原文件与全局状态，记为限制。

2026-10-06 合入续记：[#1395](https://github.com/raydocs/tono/pull/1395) 以 `574debe1` 合入 main；精确 PR head 的 [ci-gate 37391874656](https://github.com/raydocs/tono/actions/runs/37391874656) 成功，独立 high-risk 覆盖见 PR close-out 评论。`fixed` 仅表示源码合入，不表示实机验收或客户发布。
