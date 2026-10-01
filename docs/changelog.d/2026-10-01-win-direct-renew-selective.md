## 2026-10-01 · Windows DIRECT 续租失败改为选择性放行
- 归属：SHIP_PLAN §2 第 10 项（续租失败切断用户网络）；影响 Windows WFP 与已连接会话。
- 来源：main `36844a4a` → `eaf19fb8`；分支 `hunt/grok-winapp-direct-renew-2a89`；Fixes #907；未合 main。
- 缺陷修复：非严格模式下，DIRECT 续租失败不再把流量收成 Blocked。服务留下当前 WFP，应用释放普通网络并装上助手拦截。已提交租约过期时，看门狗同样选择性放行。显式严格 Kill Switch 仍保持 Blocked。提交失败日志改为说明结果是 Blocked。关联 `WIN-DIRECT-RENEW-SELECTIVE`。
- 新增/优化：无。
- 工程与测试：`a_direct_renewal_failure_releases_unless_the_kill_switch_is_strict`；`mismatched_renewal_does_not_block_the_network`；`a_lost_committed_direct_lease_releases_unless_the_kill_switch_is_strict`。
- 验证：本机 rustc 1.83 无法编译 edition 2024，未运行 `cargo test`。hosted Windows CI 执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware。重载进行中的 Pending/Bracket 过期仍收成 Blocked。DNS 恢复无法证明时选择性放行会被拒绝，原保护保留。
