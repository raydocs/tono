## 2026-09-30 · Windows 健康监视把防抖窗口内的下一次变化留到窗口结束
- 归属：SHIP_PLAN §2 第 10 项（网络变化后 DIRECT 绑定或 Core 身份不再被看见）；影响 Windows 连接健康监视。
- 来源：main `5ba113d2` → 分支 `hunt/grok-winapp-debounce-defer-2a89`；PR 待开；未合 main。
- 缺陷修复：防抖抑制的那一拍不再前进网络事件计数，也不提交被抑制的 Core 身份基线。窗口结束后下一拍仍能看到这次变化。窗口内的第一次变化仍立即处理。关联 `WIN-DEBOUNCE-DROPS-EVENT`。
- 新增/优化：无。
- 工程与测试：`a_debounced_sample_stays_visible_until_the_window_elapses`。
- 验证：本机 rustc 1.83 无法编译 edition 2024，未运行 `cargo test`。hosted Windows CI 执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware。未在实机上验证 Wi-Fi 切换落在 WinTUN 回调后的两秒内时会补一次探测。
