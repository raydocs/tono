## 2026-10-12 · 运维台：失败聚类整行改成中文
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/ops-console`，仅前端，无服务端改动。
- 来源：基线 `origin/main`（396331705）→ 分支 `feat/ops-cluster-labels`；未合 main。
- 缺陷修复：生产「今天」页的失败聚类块整行是英文机器串，等宽字体，例如 `TONO_NODE_OR_CORE_UNREACHABLE · verifyingTraffic · windows 0.0.75 · Los Angeles · Marina · 2 人 / 1 台 · open`、`TONO_FAIL_OPEN · protection · windows 0.0.75 · unselected · 4 人 / 1 台 · quiet`；操作员读的是英文枚举、阶段名和状态词。
- 新增/优化：
  - 每行改成「中文句子 · 阶段 · 平台 版本 · 节点 · N 人 / M 台 · 状态」，正文字体；机器码放在句子的 `title` 上，悬停可见。
  - `src/copy/diagnostics.ts` 加 `clusterCode`（先用客户页已有的错误码句子，再补 TONO_ 连接/登录/P0 断网类的句子，查不到仍显示原码）、`clusterStage`（连接步骤、自愈阶梯、掉线保护上报的阶段）、`clusterStatus`（服务端只有 open/quiet：进行中/已安静）、`clusterNode`（`unselected` 或空显示「没选节点」）；未知值一律原样显示，不隐藏。
  - 严重级别为 p0 的聚类行首加「严重」标签（`copy.severity.severe`，与事件抽屉同色）。
  - 原来行尾的事件数不再显示（人数/台数已在行内）。
- 工程与测试：新组件 `ClusterRow`（`FailureClusters` 只负责取数），删除 `format.ts`；vitest 一例覆盖四个映射（已知→中文、未知→原值），一例渲染一行（中文句子、`title` 是原码、p0 标签）；`e2e/today.spec.ts` 失败聚类一例改断言中文整行且可见文本没有 `TONO_`。
- 验证（本机，`services/ops-console`）：`npm run -s typecheck`、`npx vitest run`、`npx eslint src e2e`、`npm run build`、Playwright（today、today-phone、states，`--ignore-snapshots`）见交付报告。
  截图基线 `today/list.png`、`digest-dense.png`、`quiet.png` 与 `today-phone` 会变（失败聚类块文字和高度），本提交没有重录。
- 候选/发布：无新包，仅源码。
- 剩余限制：阶段与错误码在服务端是自由文本（只有字符集限制），未覆盖的值按原文显示；sing-box 配置校验类 `TONO_SINGBOX_*`、更新类码本次没有写中文句子。
