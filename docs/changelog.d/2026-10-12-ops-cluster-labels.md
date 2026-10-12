## 2026-10-12 · 运维台：失败聚类整行改成中文
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/ops-console`，仅前端，无服务端改动。
- 来源：基线 `origin/main`（396331705）→ 分支 `feat/ops-cluster-labels`；未合 main。
- 缺陷修复：生产「今天」页的失败聚类块整行是英文机器串，等宽字体，例如 `TONO_NODE_OR_CORE_UNREACHABLE · verifyingTraffic · windows 0.0.75 · Los Angeles · Marina · 2 人 / 1 台 · open`、`TONO_FAIL_OPEN · protection · windows 0.0.75 · unselected · 4 人 / 1 台 · quiet`；操作员读的是英文枚举、阶段名和状态词。
- 新增/优化：
  - 每行是一条带发丝线分隔的列表行（`src/styles/today-clusters.css`）：列表是一个 CSS grid，每行用 subgrid，≥641 px 五列 `32px minmax(0,1fr) minmax(0,1.4fr) auto auto`、列间距 16 px，所以三条句子的起点同 x：严重列（固定 32 px，p0 写「严重」12 px/500，颜色用事故卡红条同一个文字色 `--sev-fg`，深色主题自动换；非 p0 为空）、中文句子（中等字重、主色，机器码在 `title`）、`阶段 · 平台 版本 · 节点`（次要色，单行省略号，`title` 是完整文字）、`N 人 / M 台`（右对齐，`tabular-nums`）、状态（灰色 `ops-tag`：进行中/已安静）。
  - ≤640 px 一行叠成三行：严重+句子 / 细节 / 人数（左）+状态（右）；细节行是 flex 换行，阶段、平台版本、节点各是一个不断开的条目，间隔用 `gap`，「·」在手机上隐藏（`aria-hidden`），所以行首行尾都不会出现「·」；过长的条目用省略号，不撑出横向滚动。行不跳转，所以没有悬停态，代码注释里写明。
  - 标题写成「失败聚类N」，N 是 13 px/400、次要色、与标题隔 8 px、基线对齐、`tabular-nums`（`.cluster-count`）；`Section` 的 `title` 放宽成 `ReactNode` 以放计数，标题字号未动。0 条仍是原来那句空话。
  - `src/copy/diagnostics.ts` 加 `clusterCode`（先用客户页已有的错误码句子，再补 TONO_ 连接/登录/P0 断网类的句子，查不到仍显示原码）、`clusterStage`（连接步骤、自愈阶梯、掉线保护上报的阶段）、`clusterStatus`（服务端只有 open/quiet：进行中/已安静）、`clusterNode`（`unselected` 或空显示「没选节点」）；未知值一律原样显示，不隐藏。
  - 严重级别为 p0 的聚类行在专用的严重列写「严重」（`copy.severity.severe`），不用早报药丸。
  - 阶段词全改名词：连接中→连接、已连接→连接后、保护 DNS→DNS 保护；map 里不再有「中/着」的进行时。
  - 默认 fixture 第一条（Los Angeles · Mesa）改成 `TONO_FAIL_OPEN` / `protection` 的 p0（`TONO_TLS_TIMEOUT` 不在控制面 P0 清单里，原来整页看不到「严重」）；dense fixture 本来就有一条 p0，另把 fc-08 改成 `quiet`，两种状态都有。
  - 原来行尾的事件数不再显示（人数/台数已在行内）。
- 工程与测试：新组件 `ClusterRow`（`FailureClusters` 只负责取数），删除 `format.ts`；vitest 一例覆盖四个映射（已知→中文、未知→原值），三例渲染一行（中文句子、`title` 是原码、p0 的严重格、非 p0 的空严重格、细节 `title` 与三段分隔）；`e2e/today.spec.ts` 失败聚类一例断言中文整行且可见文本没有 `TONO_`，另一例在 1440 断言三条句子同 x、细节格单行（≤24 px）；`e2e/today-phone.spec.ts` 一例断言 390 下细节行的任何一行都不以「·」开头或结尾。
- 验证（本机，`services/ops-console`）：`npm run -s typecheck`、`npx vitest run`、`npx eslint src e2e`、`npm run build`、Playwright（today、today-phone、states，`--ignore-snapshots`）见交付报告。
  截图基线 `today/list.png`、`digest-dense.png`、`quiet.png` 与 `today-phone` 会变（失败聚类块文字和高度），本提交没有重录。
- 候选/发布：无新包，仅源码。
- 剩余限制：阶段与错误码在服务端是自由文本（只有字符集限制），未覆盖的值按原文显示；sing-box 配置校验类 `TONO_SINGBOX_*`、更新类码本次没有写中文句子。
