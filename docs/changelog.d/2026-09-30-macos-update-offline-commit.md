## 2026-09-30 · macOS Protected Offline 更新允许放行后提交
- 归属：SHIP_PLAN §2 第 10 条（装上会坏）。macOS 原生更新、共享值契约与启动保护显示。
- 来源：main `80f4b4d0` → 分支 `codex2/mac-update-offline-commit`；PR #795；未合 main。
- 缺陷修复：Protected Offline 更新换入新 helper 后，Core 已停，启动按现有释放路径解除 PF；旧契约仍要求 Protected Offline，导致恢复与提交证据被拒绝、更新一直 pending、Connect 被挡。`UpdateContractV1.recoverySatisfies` 只在恢复与提交阶段允许 Protected Offline 接受真实 Unprotected；Connected 与 Unprotected 仍要求各自精确匹配。App 在该路径提交成功后读取 helper 当前保护状态，经认证确认已释放后清除本地武装意图与已保护显示，再清除 Connect 门控；关联 [MAC-UPDATE-OFFLINE-COMMIT-STUCK](../findings.d/MAC-UPDATE-OFFLINE-COMMIT-STUCK.md)。
- 新增/优化：无。不重新武装 PF，不新增 AI 阻断层；沿用 helper 标准释放路径，等待独立 PR #738 接入。健康连接与现有严格杀开关规则不变。
- 工程与测试：helper 新增一条回归，验证 Protected Offline 收据在实际读数为 Unprotected 时完成恢复、提交并放开 `/core/start`；既有 Connected 所有权回归补上恢复与提交阶段都拒绝 Unprotected。既有 App XCTest 文件新增一条启动回归，验证提交后读取实时保护状态并清除已保护显示与 Connect 门控。
- 验证：本 Linux 工作树以 `80f4b4d0` 为基线；`git diff --check` 与记录读取检查通过，Swift 改动逐行复核。无 Swift/Xcode，helper self-test、XCTest 与原生编译未执行，须由 hosted macOS CI 运行；无 Windows 工具链，未运行 Windows 测试。
- 候选/发布：仅源码，无新候选。
- 剩余限制：`needs-hardware`；更新后普通互联网可用、界面已释放与再次 Connect 须签名候选实机验证。提交失败、回执丢失或提交后状态不可读时，既有路径仍可能保留旧保护意图或显示；本次只修成功提交后的实时对账。`HelperProtocolVersion.swift` 与 `CONTRACT.sha256` 未改，操作员需升 helper 版本并更新摘要后才可运行构建门；本条不代表 CI 或设备验收通过。
