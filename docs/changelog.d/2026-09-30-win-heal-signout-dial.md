## 2026-09-30 · Windows 登出丢弃上一账户的自愈拨号
- 归属：SHIP_PLAN §2 第 10 项（下一账户连到错误出口）；影响 Windows 连接自愈状态。
- 来源：main `ff81118a` → `6a614e7c`；分支 `hunt/grok-winapp-heal-signout-2a89`；PR #874；未合 main。
- 缺陷修复：账户关闭成功并丢弃目录后，把内存中的 heal 会话重置为空首选。下一次 `prepare` 按当前选择重新建立拨号，不再沿用上一账户的备用节点或 `pending_dial`。关联 `WIN-HEAL-SIGNOUT-DIAL`。
- 新增/优化：无。同一登录会话里、保护放下前的故障转移不变。
- 工程与测试：`sign_out_drops_the_previous_accounts_failover_dial`。
- 验证：本机 rustc 1.83 无法编译 edition 2024 的 Windows crate，未运行 `cargo test`。hosted Windows CI 执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware。未在实机上切换两个账户验证所选城市与实际出口一致。
