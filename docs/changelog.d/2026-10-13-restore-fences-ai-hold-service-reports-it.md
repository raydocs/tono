## 2026-10-13 · Windows：Service 报告保留的 AI 拦截；「恢复网络」隔离更早排队的窄放行
- 归属：SHIP_PLAN §2 item 10；Windows App 与 Service。所有者决定 [125](../decisions/125-2026-10-13-quit-and-replacement-keep-ai-hold.md)：「恢复网络」永远是完整放开。
- 缺陷修复：#1052 / #1120 的两处遗留（#1642 复审）。(1) Service 状态快照新增 `ai_hold_retained`（选择性层最后一次请求的处置；崩溃、退出、换号、更新失败留下的拦截都会显示，重新武装或完整放开会清掉）；App 在启动恢复时保存、并在 Sign Out 时再向 Service 问一次，所以重开 App 后首次 Connect 前 Sign Out 仍做完整放开；旧 Service 不发该字段时 App 保持原来的进程内记忆。另一用户的屏障不算给调用者的拦截。(2) 发布记录处于 Released 模式（显式「恢复网络」之后、还没有新的 Connect）时，更早排队的 Quit／换号窄放行只做完整放开，不再重装「恢复网络」刚删掉的拦截。
- 新增/优化：无。
- 工程与测试：`narrow_release_verdict`、`selective_layer::ai_hold_retained`、`stored_protection_of` 的回归与 Sign Out 跨重启回归，红先于绿；协议向后兼容（可选字段，`serde(default)`），未改协议版本。
- 验证：见 PR 的 Verification。未在本机运行 cargo。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无 Windows 实机（WFP / NRPT / 防火墙规则）；Service 重启后 `ai_hold_retained` 从启动时重放的墓碑得知，没有证据的拦截（墓碑写失败）不会被报告。
