## 2026-10-01 · Windows 新连接丢掉过期的签名直连路径
- 归属：SHIP_PLAN §2 第 10 项（全隧道被两分钟路径刷新反复重连）；影响 Windows 已连接会话。
- 来源：main `17580a26` → `b6e239de`；分支 `hunt/grok-winapp-wechat-paths-2a89`；PR #900；未合 main。
- 缺陷修复：一次新尝试在清可选 DIRECT 标志的同时把 `applied_wechat_path_regexes` 置为 `None`。全隧道会话不再因为上一场覆盖层的路径集，在签名路径变化后每两分钟受保护重连。关联 `WIN-WECHAT-PATH-STALE`。与 #757 不同：那边要求路径变化必须重连，这边避免覆盖层已经不在时仍重连。
- 新增/优化：无。
- 工程与测试：`a_new_attempt_drops_signed_app_paths_so_a_full_tunnel_does_not_reconnect`。
- 验证：本机 rustc 1.83 无法编译 edition 2024，未运行 `cargo test`。hosted Windows CI 执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware。未在真机上观察两分钟刷新。覆盖层成功提交后仍会写回当前路径，该重连行为不变。
