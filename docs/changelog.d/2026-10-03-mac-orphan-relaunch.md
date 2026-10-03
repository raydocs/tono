## 2026-10-03 · macOS：App 死后 helper 把它拉回来
- 归属：SHIP_PLAN §2 第 10 项；macOS root helper（`tooling/scripts/core-helper/SocketServer.swift`）。
- 来源：基线 `eb363310` → 分支 `fix/mac-orphan-relaunch-20261003`；已合入 main（#1362，`854e91cc`）。
- 缺陷修复：App 在保护未解除时崩溃或被强退，之前没有任何东西把它拉回来，用户看不到状态、没人重连，只能等放开或手动重开（MAC-ORPHAN-NO-RELAUNCH，#1269 的后续）。现在 helper 的空闲检查发现属主已退出且 PF 还有阻断时，以该用户身份让 Launch Services 打开已安装、签名校验通过的 Tono.app，每个死掉的属主最多两次、间隔约 30 秒，打开请求不等待返回；App 自己走崩溃后恢复（PF 已武装则自动重连）。决策 049 的 70 秒放开保留为最后保险。条件和被拒选项见决策 052。
- 新增/优化：无其他。
- 工程与测试修正：回归（`orphanedOwnerRelaunchDue` 决策自测）先单独推送为 `b3499928`（红），派发运行见 PR。helper 协议版本 `4.52.40`，`CONTRACT.sha256` 重算。
- 独立评审：Codex gpt-6.1-sol high 只读评审 `eb363310..5c5ac233`，1 major（`open` 在持锁空闲循环里无限等待）已修为不等待；2 minor 记录在 finding 片段；覆盖和 SHA 见 PR 评论。
- 验证：仅托管 CI（helper 自测、构建、privileged-tests）；没有 Mac 实机验证，标 needs-hardware。仅源码，无新候选。

### 2026-10-03 续记：已合 main
- 来源合入：#1362，merge commit `854e91cc`，PR 头 `d680fa76`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37110582602 （build、privileged-tests 的 helper 自测链通过）。红测试 `b3499928`：run 37110061560 红，但红在 helper 合约摘要检查（`digest-mismatch: error`，红提交未重算 `CONTRACT.sha256`，且自测调用的 `orphanedOwnerRelaunchDue` 当时还不存在，本就不能编译），不是自测自己的失败信息。
- 独立评审：Codex gpt-6.1-sol high 只读两轮，记录在 https://github.com/raydocs/tono/pull/1362#issuecomment-5967316722 ：r1 `eb363310..5c5ac233` 1 major（`open` 在持锁空闲循环里等待）→ `d680fa76` 改为不等待的 `Process` + `sudo -n`；r2 `5c5ac233..d680fa76` 0 major，2 minor 保留开放（finding 片段），A–F 全覆盖，CONTRACT 重算一致。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证（needs-hardware）：`launchctl asuser … sudo -n -u … open` 在守护进程上下文的实际行为依赖原生升级拉起路径的先例。
