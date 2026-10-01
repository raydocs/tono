## 2026-09-30 · Windows DIRECT 策略续租与空规则跳过

- 归属：SHIP_PLAN §2 第 10 项 / G1 Windows DIRECT。Windows App 的 DIRECT overlay 与 Service 租约。
- 来源：main `ff04bae0` → 分支 `codex2/win-direct-heartbeat-policy`；PR #786；已并入 `origin/main` `b1825a3a`。心跳仍按已验证策略续租，空规则图仍在 staging 前跳过。
- 缺陷修复：相同路由策略只更新 revision 时，原始 JSON digest 改变会停掉心跳，但策略同步不重连；Service 租约到期后撤回 TUN permit，健康会话进入 Blocked。心跳现在比较已验证策略行为，内容不变继续续租，行为改变仍走原有重连路径。suffix-only 或 WeChat 地址 pins 为空的计划可能不生成 controller DIRECT 规则；现在在 runtime staging 与 Service reload bracket 前跳过空规则图，避免反复 Blocked、重连、再阻断。对应 `WIN-DIRECT-HEARTBEAT-REVISION-STOP`、`WIN-DIRECT-EMPTY-GRAPH-LOOP`。
- 新增/优化：无。
- 工程与测试：在 `connection.rs` 原有测试区各加一条回归：仅 revision 更新继续心跳、行为变化停止；suffix-only 计划没有 controller DIRECT 规则并被跳过。
- 验证：本环境无 Cargo、Windows 工具链和 Xcode，Windows Rust 回归未执行；hosted Windows CI 待跑。源码与差异逐行复核，未作 Windows 实机网络验收。
- 候选/发布：仅源码，无新候选。
- 剩余限制：`needs-hardware`。策略重新签发、Service 租约看门狗与空图跳过后的联网状态仍需 Windows 实机验证；不能据此声称已通过网络验收。
