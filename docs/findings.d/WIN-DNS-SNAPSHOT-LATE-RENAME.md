| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DNS-SNAPSHOT-LATE-RENAME | Windows 被预算丢弃的 DNS 操作留下的按路径改名（快照隔离）和原子写入末尾的替换仍会迟到落地，可以挪走或覆盖后继写到同一路径的 DNS 快照；#1395 只围住了迟到的删除 | open | 待开 | 低·推导 | 前提窄：隔离改名要快照不可读，再加文件系统调用卡过 40 秒预算，且迟到的那次晚于后继写入落地；被挪走的快照留在 `corrupt-<时间>.json`，原始 DNS 可手工找回，之后的恢复走无快照路径，仍 fail-closed；迟到替换在已追的失败恢复路径上写回的是同一份原始值，后果未见；enable 一侧是否会被预算丢弃未查；修法方向：这两处也持 `SNAPSHOT_DELETE` 到阻塞调用返回，或改用不可复用的世代文件名 |

2026-10-05 复核 #1395 时记录，源码推导，未复现。`quarantine_snapshot` 用 `tokio::fs::rename`，`atomic_write` 末尾的 `atomic_file::replace` 在 Windows 上是阻塞线程里的 `MoveFileExW`，自带 30 秒超时，超时后线程继续跑；两处都在 `apps/windows/service/src/core/`。与 [WIN-DNS-SNAPSHOT-LATE-DELETE](WIN-DNS-SNAPSHOT-LATE-DELETE.md) 同类，机制不同。

另记一处不一致，未判断是否有意：`settle_snapshot_delete` 的失败在 `enable_unlocked` 和 `restore_protected` 里直接返回，没有经过 `record_outcome`，相邻的错误都经过它。
