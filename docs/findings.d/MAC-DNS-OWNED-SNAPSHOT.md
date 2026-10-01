| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-DNS-OWNED-SNAPSHOT | macOS DNS restore / handoff / 同 owner 重启曾把快照旧值写回覆盖新 DNS，稳定 ID I/O 失败又可退到复用的同名服务 | fixed（源码已合 main） | [#690](https://github.com/raydocs/tono/pull/690)；head `453ae24f`；merge `a1e333e6`；helper 4.52.0 | 中·已确认 | 精确头 hosted CI 与独立增量审查通过；未实机验证或发布；不同服务的 loopback 清扫及首装 loopback 快照仍见 BRICK-M12 |

2026-09-30：静态审计确认 `restoreServices` 和 `enable` 的 handoff 在读当前 owner DNS 前无条件写快照。此分支改为按快照 service ID 识别、先读再决定；非 Tono DNS 不改写，存档快照，restore 回报 `originalDNSRestored:false`。读取失败仍拒绝释放；缺失 ID 证据不按名字猜测。

2026-09-30 复核续修：审查 `3326b711` 发现稳定 ID 的 SC 读写失败会退到同名服务，且同 owner re-enable 会在外部新 DNS 上重写 loopback 却保留旧快照。续修使 ID 读写失败直接抛错；同 owner 先读、存档旧快照并持久化新 DNS，再写 loopback，重试保持新快照。helper 自测加入两个生产接缝的注入回归；静态检查不代替 hosted 编译、CI 与设备验收。

2026-09-30 交付：最终首次 enable gate 也拒绝未知/空 service ID，legacy 名字快照恢复保持不变。准确 `453ae24f` [CI36688400051](https://github.com/raydocs/tono/actions/runs/36688400051) 四个 jobs success，helper 自测与 XCTest 执行；独立 Codex high 的初审→两项纠正→最后身份 gate 增量覆盖见 [审查记录](https://github.com/raydocs/tono/pull/690#issuecomment-5907437299)。实际旧代码 `ae6f318b` [CI36685435186](https://github.com/raydocs/tono/actions/runs/36685435186) 编译后 superseded-restore 回归失败；不声称最后身份 gate 或 same-owner 用例单独旧代码 red。main 合并 `a1e333e6b25d155dbf95d27147f915a7e3250894`；源码交付不等于设备验收、事故根因已定位或客户发布。
