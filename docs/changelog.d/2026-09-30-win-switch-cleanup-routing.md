## 2026-09-30 · Windows 节点切换清理限时与住宅路由更新重建

- 归属：[SHIP_PLAN](../SHIP_PLAN.md) §2 第 10 项（装上会坏）；影响 Windows app 的节点切换、目录同步与住宅链路 WFP 许可。
- 来源：main `ff04bae0` → 分支 `codex2/win-switch-cleanup-routing`；PR 待开；未合 main。
- 缺陷修复：旧出口有大量连接且 Mihomo 控制器挂起时，逐条 DELETE 的 2 秒超时会累加，并持续占用生命周期写锁，拖延 Disconnect / Restore internet。现在获取连接和删除循环共用 3 秒预算，连接取消或代次变化即停止，首个 DELETE 错误即退出；清理仍为尽力而为，不因清理失败中止切换。关联 [WIN-SWITCH-CLEANUP-HOLDS-RELEASE](../findings.d/WIN-SWITCH-CLEANUP-HOLDS-RELEASE.md)。已连接会话收到住宅路由或同名住宅节点拨号身份变化时，原来只更新内存目录，运行核心仍拨旧住宅端点，后续热切换却会删除旧端点的 WFP 许可；现在比较新旧住宅路由，在状态锁外按原连接代次复用保持保护的冷重建路径，并持有选择/策略写锁直到重建完成，防止期间热切换使用未生效的新路由。关联 [WIN-CATALOG-ROUTING-CHANGE-STALE-RUNTIME](../findings.d/WIN-CATALOG-ROUTING-CHANGE-STALE-RUNTIME.md)。
- 新增/优化：无。仅默认出口提示、无关出口节点变化或目录增长不触发住宅路由重建。
- 工程与测试：`switch.rs` 新增一个暂停时钟回归 `connection_cleanup_bounds_the_lifecycle_writer_for_many_sockets`，断言大量连接清理最多占用 3 秒，并在释放写锁后允许后继释放取得锁；`catalog_sync.rs` 新增一个纯判定回归 `residential_routing_change_tracks_the_home_dial_identity_only`，覆盖住宅节点端点/身份、homeProxy、home_socks5 变化及无关目录变更。
- 验证：本工作树逐行复核 Rust 差异；`git diff --check` 与记录读取通过。本环境无 Windows / Xcode，Windows Rust 无法在此编译，未运行 Rust 测试或网络行为验收。hosted Windows CI 待跑，尚无通过证据。
- 候选/发布：仅源码，无新候选。
- 剩余限制：网络行为需 `needs-hardware`，待 Windows 实机验证控制器挂起时的恢复、住宅路由轮换、目录同步与切换/断开的竞态；Connecting 阶段的目录路由变化不在本轮范围，沿用原行为，不能声称已修复。
