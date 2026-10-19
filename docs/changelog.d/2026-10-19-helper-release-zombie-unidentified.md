## 2026-10-19 · macOS 辅助程序：僵尸进程与已替换的程序不再挡住连接
- 归属：G2 macOS 辅助程序（恢复互联网 / 连接准入）；`tooling/scripts/core-helper`，helper 4.52.57 → 4.52.58。
- 来源：`origin/main` `b5b82a126` → 分支 `fix/helper-zombie-release`；未合 main。发现见 [REL-ZOMBIE-UNIDENTIFIED](../findings.d/REL-ZOMBIE-UNIDENTIFIED.md)。
- 缺陷修复：
  - 未回收的僵尸进程：`ReleaseProcessTable.state` 改用 `PROC_PIDTBSDINFO` arg=1（XNU 先找存活进程，找不到再找僵尸），
    僵尸读成 gone，不再是 unknown。
  - 读不到可执行文件路径的进程：`ReleaseChildren.end` 先用 `csops(CS_OPS_STATUS)` 问内核它是不是平台代码；
    不是平台代码的（例如运行中被升级、原文件已删除的 App）不再把全部组件记为 busy。
    平台代码或状态读不到的仍按无法识别处理。
  - 原场景：一位客户的 Mac 有 9 个僵尸进程和 17 个原文件已被替换的进程，「准备安全组件」一直拒绝连接。
- 新增/优化：无。保留：PF/DNS/路由检查、签名要求、恢复状态文件与进程白名单都不变。
- 工程与测试：`ReleaseTests.swift` 新增两条 `--release-self-test` 回归（未回收的 `/usr/bin/true` 读成 gone；
  ad hoc 重签并删除原文件的 `/bin/sleep` 副本不被列为无法识别）。红检查与验证见 PR 验证评论。
- 验证：见 PR 验证评论。本机未编译（仓库规定 MacBook 不跑 swiftc），由托管 macOS CI 构建并以 root 运行自测。
- 候选/发布：仅源码，无新候选。
- 剩余限制：修复前已经卡住的机器，装上新版后仍要再点一次「恢复正常网络」；平台二进制被替换（系统更新）的情形仍按无法识别处理。
  这条改动属于安全相关的辅助程序代码，合入前要过一轮 Codex 审查。
