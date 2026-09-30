| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-DNS-OWNED-SNAPSHOT | macOS DNS restore / service handoff 未先确认同一稳定 service ID 仍保有 Tono DNS，就把快照旧值写回，覆盖用户较新的显式 DNS | open | `fix/macos-dns-external-ownership-20260930`；PR 待建；root 已集成 helper 4.52.0 | 中·已确认 | 源码事务修复与注入回归待 CI；未实机验证；不同服务的 loopback 清扫仍见 BRICK-M12 |

2026-09-30：静态审计确认 `restoreServices` 和 `enable` 的 handoff 在读当前 owner DNS 前无条件写快照。此分支改为按快照 service ID 识别、先读再决定；非 Tono DNS 不改写，存档快照，restore 回报 `originalDNSRestored:false`。读取失败仍拒绝释放；缺失 ID 证据不按名字猜测。
