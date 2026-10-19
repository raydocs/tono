## 2026-10-19 · macOS 辅助程序：僵尸进程与已替换的程序不再挡住连接
- 归属：G2 macOS 辅助程序（恢复互联网 / 连接准入）；`tooling/scripts/core-helper`，helper 4.52.57 → 4.52.58。
- 来源：`origin/main` `b5b82a126` → 分支 `fix/helper-zombie-release`；未合 main。发现见 [REL-ZOMBIE-UNIDENTIFIED](../findings.d/REL-ZOMBIE-UNIDENTIFIED.md)。
- 缺陷修复：
  - 未回收的僵尸进程：`ReleaseProcessTable.state` 改用 `PROC_PIDTBSDINFO` arg=1（XNU 先找存活进程，找不到再找僵尸），
    僵尸读成 gone，不再是 unknown。
  - 读不到可执行文件路径的进程：`ReleaseChildren.end` 先问内核它的三个用户 id（`proc_bsdinfo`）和签名状态
    （`csops(CS_OPS_STATUS)`）。三个 id 都不是 root、且不是平台代码的（例如用户运行中被升级、原文件已删除的 CLI 或 App）
    不再把全部组件记为 busy。root 进程（Tono 的 core / helper / 更新执行器都以 root 运行，升级替换文件后同样读不到路径）、
    平台代码或任一项读不到的仍按无法识别处理。
  - 原场景：一位客户的 Mac 有 9 个僵尸进程和 17 个原文件已被替换的进程，「准备安全组件」一直拒绝连接。
- 新增/优化：无。保留：PF/DNS/路由检查、签名要求、恢复状态文件与进程白名单都不变。
- 工程与测试：`ReleaseTests.swift` 新增 `--release-self-test` 回归：未回收的 `/usr/bin/true` 读成 gone；
  ad hoc 重签并删除原文件的 `/bin/sleep` 副本，以 nobody 运行时不被列为无法识别、以 root 运行时仍被列为无法识别。
  每条先确认目标存活、被枚举且路径读不到，进程表读不到即失败。红检查与验证见 PR 验证评论。
- 验证：见 PR 验证评论。本机未编译（仓库规定 MacBook 不跑 swiftc），由托管 macOS CI 构建并以 root 运行自测。
- 候选/发布：仅源码，无新候选。
- 剩余限制：修复前已经卡住的机器，装上新版后仍要再点一次「恢复正常网络」；以 root 运行、文件已被替换的第三方程序
  （例如代理软件的特权辅助进程）仍按无法识别处理，重启后消失。
  这条改动属于安全相关的辅助程序代码，合入前要过一轮 Codex 审查。

2026-10-19 续（Codex 审查 `aa59fa6c6`：block）：
- P1（major）：只看「不是平台代码」会漏掉文件被升级替换、仍在运行的 Tono root core。改为同时要求三个用户 id 都不是 root。
- P2：删除文件的回归可能在目标提前退出或进程表读不到时误判通过。改为先确认目标存活、被枚举且路径读不到；
  新增 root 对照（仍被列为无法识别）。
