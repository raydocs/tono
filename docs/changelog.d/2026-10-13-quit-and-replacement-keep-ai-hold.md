## 2026-10-13 · Windows：退出和更换账户登录保留 AI 拦截；更新失败只保留该有的拦截
- 归属：SHIP_PLAN §2 item 10；Windows App 与 Service。所有者决定 [125](../decisions/125-2026-10-13-quit-and-replacement-keep-ai-hold.md)（2026-10-13 直接回答，状态 owner）。
- 缺陷修复：#1052（Windows 半）已连接的 Quit 和无产品状态的 Quit 改走 Service 的窄放行请求（`release_for_quit`；旧 Service 不认窄请求时退回今天的完整放开）；#1120 换号登录的运行时退休走独立的窄处置（`release_for_account_replacement`，只用于 `adopt_replacing_with`），Sign Out、Restore 与 `release_for_account` 不变；#1293 第 4 项 失败的原生更新不再给 Unprotected 用户或刚明确「恢复网络」的用户新装 AI 拦截（`release_applying_narrow_if_owed`、`emergency_disarm_with` 先读「是否该有」：武装中，或意图文件是 wanted / 窄处置 / 不可读）；#1055 行 R3REGW-ROLLBACK-DOUBLE-HOLD 第二次紧急放行不删第一次装上的拦截（#1087 已让重装原地进行，本 PR 加回归）。
- 新增/优化：无。
- 工程与测试：`internal_release_applies_narrow`（Quit、AccountReplacement）两条回归，红先于绿；服务端 `failed_update_recovery_does_not_install_an_ai_hold_for_an_unprotected_user`、`failed_prepare_does_not_install_an_ai_hold_for_an_unprotected_user`（旧代码红）；`a_second_failed_update_release_keeps_the_hold_the_first_installed`（旧代码本来就绿，只钉住行为）；`interrupted_update_emergency_release_replays_the_ai_hold` 改为先武装（它模拟的是受保护会话的更新失败）。
- 验证：见 PR 的 Verification。未在本机运行 cargo。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无 Windows 实机（WFP / NRPT / 防火墙规则）；#1293 其余 1–3、5、6 项未动；macOS 退出见另一个 PR。选择性拦截仍是 best effort。
