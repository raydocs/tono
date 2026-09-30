| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-DNS-OWNED-SNAPSHOT | macOS DNS restore / handoff / 同 owner 重启曾把快照旧值写回覆盖新 DNS，稳定 ID I/O 失败又可退到复用的同名服务 | open | `fix/macos-dns-external-ownership-20260930`；PR 待建；root 已集成 helper 4.52.0 | 中·已确认 | 两处复核 major 的源码续修与注入回归待 CI；未实机验证；不同服务的 loopback 清扫仍见 BRICK-M12 |

2026-09-30：静态审计确认 `restoreServices` 和 `enable` 的 handoff 在读当前 owner DNS 前无条件写快照。此分支改为按快照 service ID 识别、先读再决定；非 Tono DNS 不改写，存档快照，restore 回报 `originalDNSRestored:false`。读取失败仍拒绝释放；缺失 ID 证据不按名字猜测。

2026-09-30 复核续修：审查 `3326b711` 发现稳定 ID 的 SC 读写失败会退到同名服务，且同 owner re-enable 会在外部新 DNS 上重写 loopback 却保留旧快照。续修使 ID 读写失败直接抛错；同 owner 先读、存档旧快照并持久化新 DNS，再写 loopback，重试保持新快照。helper 自测加入两个生产接缝的注入回归；静态检查不代替 hosted 编译、CI 与设备验收。
