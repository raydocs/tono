## 2026-10-13 · macOS：退出文案对齐决策 125（退出保留 AI 拦截）
- 归属：SHIP_PLAN §2 item 10；macOS App 文案与文档。所有者决定 [125](../decisions/125-2026-10-13-quit-and-replacement-keep-ai-hold.md)（2026-10-13 直接回答，状态 owner）；同一份决策文件也在 Windows PR 里，内容逐字节相同。
- 缺陷修复：无代码缺陷。#1052 的 macOS 半在 #1445（决策 073）已修：普通退出走 `POST /killswitch/quit`，武装中或已有 retain-ai 时保留窄层，空闲退出不新装，显式「恢复网络」覆盖重叠的退出。核对结果：不需要新的助手协议，`HelperProtocolVersion.current` 不变；旧版助手在退出放行前经 `repairForRelease` 先修复（与「恢复网络」同一路径），修复失败时保持 fail-closed。
- 新增/优化：设置里「界面语言」副标题和切换语言前的确认框不再写「解除网络保护 / 断网保护解除」，改为恢复普通网络、AI 服务继续被拦截直到再次连接（en + zh-Hans，`Localizable.xcstrings` 与 `SettingsView.swift` 同步）。
- 工程与测试：无新测试（文案）；退出语义由现有 `QuitAIHoldTests` 覆盖。
- 验证：见 PR 的 Verification；本机不跑 xcodebuild。
- 候选/发布：仅源码，无新候选。
- 剩余限制：旧版助手拒绝修复（用户拒绝管理员提示）时退出仍保持 PF 武装（既有 fail-closed），本 PR 不改；原生 PF/DNS 实机留 G1/G2。
