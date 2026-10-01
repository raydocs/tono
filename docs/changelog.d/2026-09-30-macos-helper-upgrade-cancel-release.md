## 2026-09-30 · macOS helper 升级放弃后释放旧 PF

- 归属：SHIP_PLAN §2 第 10 项（装上会坏）；macOS App 的 helper 替换与网络恢复。
- 来源：main `378c165d` → 分支 `codex2/mac-helper-upgrade-cancel-release`；PR #794；未合 main。
- 缺陷修复：旧 authenticated helper 在预检停 Core 后仍持有 PF，升级提示被 withheld、取消、超时、安装失败或新 helper 启动超时会留下全网阻断。现在确认停 Core 后的所有失败出口都尽力调用 Disconnect 同用的 `KillSwitchService.disarm()`，按原路径先恢复 DNS 再释放 PF；清理失败不覆盖原安装错误。停 Core 后的预检状态读取失败也进入清理。关联 MAC-HELPER-UPGRADE-CANCEL-KEEPS-PF。
- 新增/优化：无。提示期间继续保持 PF，静默升级与管理员安装成功不释放；释放成功清除 `isArmed`，释放回复丢失时按 Disconnect 的 confirmed 状态读回收敛；本地审计分别记录 `helper_upgrade_abandoned_released` / `helper_upgrade_abandoned_release_failed`。沿用标准释放路径，不另建 AI 阻断层，待 #738 接入。
- 工程与测试：在已有 `HelperSilentUpgradeTimeoutTests.swift` 加一条 `testAbandonedUpgradeReleasesOnlyAfterPreviousCoreStopped`，覆盖仅已停 Core 且升级未成功才释放的判断；没有安装注入缝，使用小型纯判断函数。更新 bootstrap restriction 的对应注释；不改 helper 协议版本或合同摘要。
- 验证：Linux 本工作树基线 `378c165d` 的未提交 diff 逐行复核 Swift 类型、闭包、`try` 与 defer 出口；`git diff --check` 通过，`records.mjs` 可读取两份新记录。无 Swift/Xcode，未编译、未运行 XCTest；hosted macOS CI 待运行。Windows 不涉及，未运行 Windows 检查；未做 PF/DNS 实机故障注入。
- 候选/发布：仅源码，无新候选。
- 剩余限制：网络行为变更，`needs-hardware`。旧 helper 不可达、拒绝或 DNS 恢复失败时标准释放仍可能失败，只有尽力清理，不声称设备已恢复。`/core/stop` 回复丢失时不能确认已停 Core，未扩展该不确定分支；#759 的静默升级请求未到达时跳过轮询另行处理，本次不复制。#738 未合 main，本次不声称失败放行后已有窄 AI 阻断。
