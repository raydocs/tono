## 2026-10-02 · Windows：离线横幅不再带出上一次的旧错误
- 归属：SHIP_PLAN §2 第 10 项；Windows App 前端（`tono-ui/ProtectedOfflineBanner.tsx`）。
- 来源：基线 `afed1deb` → 分支 `fix/win-banner-stale-error`，PR #1348；尚未合入 main。
- 缺陷修复：「受保护离线」横幅里重试或备用通道失败的错误，在这次离线结束（横幅收起）时清掉；原先会留到下一次离线再显示出来。
  关联 WIN-BANNER-STALE-ACTION-ERROR。
- 新增/优化：无。本次离线期间的错误显示不变。
- 工程与测试修正：回归 `does not carry a failed retry into the next protected-offline episode` 先单独推送为 `b07b63e9`（红），结果记在 PR。
- 验证：仅托管 CI（vitest）；未在 Windows 实机上复现。仅源码，无新候选。

### 2026-10-02 续记：已合 main
- 来源合入：#1348，merge commit `9ab1aa23`，PR 头 `b907d02d`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37040092886 。红测试 `b07b63e9`：run 37038387614（`windows / app` vitest 1 failed）。
- 独立评审：普通风险（前端提示），主会话核对 diff；未做独立评审。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证。
