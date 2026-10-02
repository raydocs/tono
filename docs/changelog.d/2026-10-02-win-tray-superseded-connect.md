## 2026-10-02 · Windows：托盘面板不再把被取代的连接显示成错误
- 归属：SHIP_PLAN §2 第 10 项；Windows App 前端（`tono-ui/TrayPanel.tsx`）。
- 来源：基线 `41982f52` → 分支 `fix/win-tray-superseded-connect`，PR #1345；尚未合入 main。
- 缺陷修复：托盘面板的「连接」被更新的操作取代、或与仍在进行的连接重叠时，后端的拒绝不是失败的尝试，
  面板却显示成红色错误。现在和主窗口一样忽略这类拒绝并刷新状态。关联 WIN-TRAY-SUPERSEDED-CONNECT-ERROR。
- 新增/优化：无。真正的连接失败、「重试」和备用通道的错误显示不变。
- 工程与测试修正：回归 `shows no error when a newer transition supersedes the tray connect` 先单独推送为
  `a6889023`（红），结果记在 PR。
- 验证：仅托管 CI（vitest）；未在 Windows 实机上点出这个时序。仅源码，无新候选。

### 2026-10-02 续记：已合 main
- 来源合入：#1345，merge commit `0c4c07bc`，PR 头 `719438ad`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37033131351 。红测试 `a6889023`：run 37031321540（`windows / app` vitest 1 failed）。
- 独立评审：普通风险（前端提示），主会话核对 diff；未做独立评审。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证。
