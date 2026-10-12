## 2026-10-12 · 运维台：fixture 服务器补上失败聚类的读取路由
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/ops-console`，仅 fixture、开发服务器路由和一例 e2e，无页面代码和服务端改动。
- 来源：基线 `feat/ops-maturity-r1`（叠在其上）→ 分支 `fix/ops-fixture-failure-clusters`；未合 main。
- 缺陷修复：「今天」页的失败聚类块（`FailureClusters`）读 `GET /api/v1/ops/failure-clusters`，生产有这条路由，fixture 开发服务器没有，于是每一套 fixture（包括安静的空 Today 页和截图基线）都显示「失败聚类还读不到。 重试」。
- 新增/优化：
  - `vite.config.ts` 按 `fixtures` 查询参数选集合（default / dense / empty；error 沿用原有的 500）返回该路由。
  - `fixtures/failure-clusters.json`（3 组：Los Angeles · Mesa 的 TLS 握手超时、Tokyo · Fuji 的 DNS 失败、Hong Kong · Victoria 上移动网络的连接失败）、`failure-clusters.dense.json`（9 组，含一组 p0）、`failure-clusters.empty.json`（空列表）。形状逐字段对齐 `assertFailureClusterList`（`services/control-plane/src/ops/contract/customer-diagnostics.ts`），含 `severity`。
  - `e2e/today.spec.ts` 一例：empty 集合显示「这段时间没有打开的失败聚类。」且没有「重试」；default 集合列出三行聚类。
- 验证（本机，`services/ops-console`）：`npm run -s typecheck`、`npx eslint src e2e`、`npx vitest run`、Playwright（本机 chrome-headless-shell，`--ignore-snapshots`）today / today-phone / states 三个 spec 通过；新用例在去掉路由的旧 `vite.config.ts` 上失败（找不到空句子），已跑过。
  截图基线会变，本提交没有重录：`today/list.png`、`today/quiet.png`、`today/digest-dense.png`、`today-phone/today.png`（聚类块从错误行变成三行或一行空句）；两处 `drawer.png` 若背景可见聚类块也会变。`states/today-error.png` 不变（error 集合仍是 500，仍显示错误行和重试）。
- 候选/发布：无新包，仅源码。
- 剩余限制：`firstSeenMs` / `lastSeenMs` 是毫秒，`materializeOps` 不平移毫秒键，页面也不显示它们，所以保持写死的时间。
