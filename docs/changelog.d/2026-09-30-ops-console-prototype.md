## 2026-09-30 · 运维后台重做：信息架构、设计规范与可点击原型
- 归属：[运维计划](../ops/plan-2026-09-11.md)（控制台合并为一个）；只动 `services/ops-console/prototype/`、`vite.prototype.config.ts`、`package.json` 两个脚本和文档，不碰生产控制台 `src/`、Worker 与客户端。
- 来源：基于 `main` d2363002；分支 `cursor/ops-console-prototype-d728`，草稿 PR，未合 main。
- 缺陷修复：无（仅设计稿）。
- 新增/优化：[console-redesign.md](../ops/console-redesign.md) 写明一个后台挂 `/ops/` 的决定、IA（mermaid）、设计规范、数据事实（edge_* 只是用户→Cloudflare 段、Activity 字节未写入、计费以 `usage_report_sources` 为准、#707 未上线不画空图）、自评与 9 期重做计划。原型用 React + Tailwind + Radix 与 mock 数据做了 12 个页面（概览、连接质量、节点、节点详情、家宽出口、客户、客户详情、客户端、财务、设置 7 个分区、审计、设计规范），浅色/深色，面板级加载/出错/陈旧状态，`?telemetry=on` 预览 #707 面板。
- 工程与测试：原型是独立 Vite 入口，不进生产构建，也不进 `npm run lint` / `typecheck` 的范围；按控制台规则没有新增 Playwright 或 UI 单测。
- 验证：`npx tsc -p prototype/tsconfig.json --noEmit` 通过；`npx eslint prototype --max-warnings=0` 通过；生产控制台 `npm run typecheck`、`npm run lint` 通过；`npm run proto:build` 首屏 JS gzip 141.9 KB、全部 JS 172.0 KB（预算 400 / 600 KB）。截图在云端代理产物 `screenshots/after/`（35 张）与改前 `before-ops1/` `before-ops2/`。
- 候选/发布：无新包。
- 剩余限制：原型全是 mock 数据；文案沿用原型内联中文，搬进 `src/` 时要移到 `src/copy`；1280 以下布局、抽屉详情、表单规范未做；不能声称任何页面已接真接口。
