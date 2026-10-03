## 2026-10-03 · macOS：App 死后 helper 把它拉回来
- 归属：SHIP_PLAN §2 第 10 项；macOS root helper（`tooling/scripts/core-helper/SocketServer.swift`）。
- 来源：基线 `eb363310` → 分支 `fix/mac-orphan-relaunch-20261003`；尚未合入 main。
- 缺陷修复：App 在保护未解除时崩溃或被强退，之前没有任何东西把它拉回来，用户看不到状态、没人重连，只能等放开或手动重开（MAC-ORPHAN-NO-RELAUNCH，#1269 的后续）。现在 helper 的空闲检查发现属主已退出且 PF 还有阻断时，以该用户身份让 Launch Services 打开已安装、签名校验通过的 Tono.app，最多两次、间隔约 30 秒；App 自己走崩溃后恢复（PF 已武装则自动重连）。决策 049 的 70 秒放开保留为最后保险。条件和被拒选项见决策 052。
- 新增/优化：无其他。
- 工程与测试修正：回归（`orphanedOwnerRelaunchDue` 决策自测）先单独推送为 `b3499928`（红），派发运行见 PR。helper 协议版本 `4.52.40`，`CONTRACT.sha256` 重算。
- 验证：仅托管 CI（helper 自测、构建、privileged-tests）；没有 Mac 实机验证，标 needs-hardware。仅源码，无新候选。
