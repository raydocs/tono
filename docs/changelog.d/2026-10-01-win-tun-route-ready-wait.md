## 2026-10-01 · Windows 连接在改 DNS 之前等受保护 TUN 路由就绪
- 归属：Windows 连接流程（App `connection/stages.rs`、`platform.rs`、`transaction.rs`）；Issue #662，PR #663。
- 来源：外部分支 `HerbiusYang/tono:codex/fix-windows-tun-route-ready-wait`（PR #663）误合入 `release/windows`（`86d9539a`），没有进 main。本条把 PR #663 的净改动（`origin/main...6eb6c728`）原样移植到 main，从 `7110f7f9` 起的新分支 `fix/win-tun-route-ready-main`，无冲突。
- 缺陷修复：冷启动时 Tono 适配器已注册，但核心还没装好受保护路由，就开始改系统 DNS 和做数据面探测。现在 kill switch 加锁之后、securingDNS 之前，最多等 20 秒，直到 `198.18.5.25` 和 `198.18.0.2` 的最佳路由都选中处于 Up 状态的 `Tono` 接口。超时返回 `TONO_TUN_ROUTE_UNAVAILABLE` 和两条路由的查询细节，走现有的连接失败路径，不新增断网行为。
- 新增/优化：无。sing-box 与 mihomo 都使用 `Tono` 接口名，这个检查对两种内核相同。sing-box 默认路径核对：TUN inbound `interface_name` 固定为 `Tono`（Service `sing_box_runtime.rs` 校验），`address` 为 `198.18.0.1/30`（`198.18.0.2` 在链路上），`auto_route: true` 且只排除节点 IP，所以 `198.18.5.25` 走 TUN 默认路由；虽然 sing-box 的 fake-IP 池是 `198.18.16.0/20`，这里只查最佳路由，不发流量，判断不受影响。
- 工程与测试：连接预算表加一行 20 秒，合计 278 → 298 秒；`CONNECT_TRANSACTION_TIMEOUT` 保持 310 秒（Service 看门狗按 310 秒设定），余量从 32 秒降到 12 秒。`connect_budget_covers_a_cold_first_connect` 的合计断言同步为 298。Windows 测试 `both_protected_routes_must_select_an_up_tono_interface`。
- 验证：本机只跑了 `rustfmt --check`（新增代码无格式差异；文件里原有的格式差异不在本次改动内）。Windows 原生编译和测试由 hosted `windows-2025` CI 跑。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未在真机验证（`needs-hardware`）。#662 里 8 秒路由检查的版本不在 main 历史中，路由晚到的问题未在当前 sing-box 默认内核上复现过。
