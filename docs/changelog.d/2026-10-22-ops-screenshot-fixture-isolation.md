## 2026-10-22 · 隔离操作记录截图的 fixture 状态（#1683 部分修复）
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md) 控制台测试；不是出货门。
- 来源：基线 `d1f948f88efd4e778b92f0df44b3b1f4a0a5ae82` → 分支 `fix/1683-ops-screenshot-fixtures`（本 PR）；未合 main。
- 缺陷修复：无产品行为变更；不把 fixture 污染或基线过期记成客户运行时缺陷。
- 新增/优化：无。
- 工程与测试：`open` 未指定 session 时，以测试 ID、fixture 集、主题、repeat 和 retry 标识各自的可变 store；同一测试内导航仍复用，显式 session 原样保留。#1681 后打开库存页也会自动 POST 出口查询，原先共享 default store 把 `home.egress` 带进其他测试的 audit 截图。新增一条回归，用真实 fixture POST 模拟前一测试留下的记录；不改任何既有断言、golden、容差、超时或 retry。
- 验证：MacBook macOS 26.5.2 arm64、Node 26.12.1，当前锁文件依赖、Playwright Chromium 156.0.8078.4（v1248），测试配置原有时钟、Asia/Shanghai、zh-CN、DPR 2。旧 helper 跑新回归真实 RED：`Expected: 0 / Received: 1`（`home.egress` cell）；改后同一回归明暗主题 `2 passed`。原有 phone/desktop audit 截图及显式 session 的写入后审计流程原样运行，`6 passed`。`settings.spec.ts` + `pages-phone.spec.ts` 原样跑完（不忽略截图），`142 passed / 4 failed`，失败仅余明暗 phone/desktop 的 homeinventory。`npx eslint e2e/ops.ts e2e/settings.spec.ts --max-warnings=0` 通过。`npm run typecheck` 通过（unchecked indexed access errors 198，baseline 219）。原始日志保存于本任务主机 `/tmp/tono-1683-evidence/`。
- 候选/发布：仅测试源码，无新包、无部署；不合并、不 auto-merge、不监控 PR。
- 剩余限制：#1683 **未全部解决，不关闭**。原始 [run 39859656104](https://github.com/raydocs/tono/actions/runs/39859656104) jobs 120106758876 / 120106758931 共 8 个截图失败：audit 4 个可由本项隔离消除；#1681 PR 的 limitations 明确承认未更新基线；homeinventory 4 个基线最后录于 `86604d161`，早于 #1681 加「出口」列及自动查询。其 artifact DOM 与源码历史支持结构变化，并非 Linux 字体差异；未进行专门像素视觉审查，因此本项不更新 golden，不移除产品列来迁就旧图。nightly 真实全绿及结案由父任务核验；未跑 hosted CI、完整 nightly、原生/设备测试。
