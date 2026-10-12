## 2026-10-12 · 运维台：失败聚类整行改成中文
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/ops-console`，仅前端，无服务端改动。
- 来源：基线 `origin/main`（396331705）→ 分支 `feat/ops-cluster-labels`；未合 main。
- 缺陷修复：生产「今天」页的失败聚类块整行是英文机器串，等宽字体，例如 `TONO_NODE_OR_CORE_UNREACHABLE · verifyingTraffic · windows 0.0.75 · Los Angeles · Marina · 2 人 / 1 台 · open`、`TONO_FAIL_OPEN · protection · windows 0.0.75 · unselected · 4 人 / 1 台 · quiet`；操作员读的是英文枚举、阶段名和状态词。
- 新增/优化：
  - 每行是一条带发丝线分隔的列表行，≥641 px 四列对齐（`src/styles/today-clusters.css`，CSS grid）：中文句子（中等字重、主色，机器码在 `title`，p0 时前面加「严重」）、`阶段 · 平台 版本 · 节点`（次要色）、`N 人 / M 台`（右对齐，`tabular-nums`）、状态（灰色 `ops-tag`：进行中/已安静）；≤640 px 叠成三行（句子+标签 / 细节 / 人数+状态）。行不跳转，所以没有悬停态，代码注释里写明。
  - 标题写成「失败聚类 N」，N 用今天页标签页计数的样式（`font-mono text-micro`）；0 条仍是原来那句空话。`Section` 的 `title` 放宽成 `ReactNode` 以放计数。
  - `src/copy/diagnostics.ts` 加 `clusterCode`（先用客户页已有的错误码句子，再补 TONO_ 连接/登录/P0 断网类的句子，查不到仍显示原码）、`clusterStage`（连接步骤、自愈阶梯、掉线保护上报的阶段）、`clusterStatus`（服务端只有 open/quiet：进行中/已安静）、`clusterNode`（`unselected` 或空显示「没选节点」）；未知值一律原样显示，不隐藏。
  - 严重级别为 p0 的聚类行首加「严重」（`copy.severity.severe`），样式与事故卡上的「严重」字样一致（`text-micro` 次要色），不用早报药丸。
  - 阶段词全改名词：连接中→连接、已连接→连接后、保护 DNS→DNS 保护；map 里不再有「中/着」的进行时。
  - 默认 fixture 第一条（Los Angeles · Mesa）改成 `TONO_FAIL_OPEN` / `protection` 的 p0（`TONO_TLS_TIMEOUT` 不在控制面 P0 清单里，原来整页看不到「严重」）；dense fixture 本来就有一条 p0，另把 fc-08 改成 `quiet`，两种状态都有。
  - 原来行尾的事件数不再显示（人数/台数已在行内）。
- 工程与测试：新组件 `ClusterRow`（`FailureClusters` 只负责取数），删除 `format.ts`；vitest 一例覆盖四个映射（已知→中文、未知→原值），一例渲染一行（中文句子、`title` 是原码、p0 标签）；`e2e/today.spec.ts` 失败聚类一例改断言中文整行且可见文本没有 `TONO_`。
- 验证（本机，`services/ops-console`）：`npm run -s typecheck`、`npx vitest run`、`npx eslint src e2e`、`npm run build`、Playwright（today、today-phone、states，`--ignore-snapshots`）见交付报告。
  截图基线 `today/list.png`、`digest-dense.png`、`quiet.png` 与 `today-phone` 会变（失败聚类块文字和高度），本提交没有重录。
- 候选/发布：无新包，仅源码。
- 剩余限制：阶段与错误码在服务端是自由文本（只有字符集限制），未覆盖的值按原文显示；sing-box 配置校验类 `TONO_SINGBOX_*`、更新类码本次没有写中文句子。
