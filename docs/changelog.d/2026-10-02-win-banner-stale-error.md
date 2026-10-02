## 2026-10-02 · Windows：离线横幅不再带出上一次的旧错误
- 归属：SHIP_PLAN §2 第 10 项；Windows App 前端（`tono-ui/ProtectedOfflineBanner.tsx`）。
- 来源：基线 `afed1deb` → 分支 `fix/win-banner-stale-error`，PR #1348；尚未合入 main。
- 缺陷修复：「受保护离线」横幅里重试或备用通道失败的错误，在这次离线结束（横幅收起）时清掉；原先会留到下一次离线再显示出来。
  关联 WIN-BANNER-STALE-ACTION-ERROR。
- 新增/优化：无。本次离线期间的错误显示不变。
- 工程与测试修正：回归 `does not carry a failed retry into the next protected-offline episode` 先单独推送为 `b07b63e9`（红），结果记在 PR。
- 验证：仅托管 CI（vitest）；未在 Windows 实机上复现。仅源码，无新候选。
