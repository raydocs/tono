## 2026-09-30 · 运维后台重做：信息架构、设计规范与可点击原型
- 归属：[运维计划](../ops/plan-2026-09-11.md)（控制台合并为一个）；只动 `services/ops-console/prototype/`、`vite.prototype.config.ts`、`package.json` 两个脚本和文档，不碰生产控制台 `src/`、Worker 与客户端。
- 来源：基于 `main` d2363002；分支 `cursor/ops-console-prototype-d728`，草稿 PR，未合 main。
- 缺陷修复：无（仅设计稿）。
- 新增/优化：[console-redesign.md](../ops/console-redesign.md) 写明一个后台挂 `/ops/` 的决定、IA（mermaid）、设计规范、数据事实（edge_* 只是用户→Cloudflare 段、Activity 字节未写入、计费以 `usage_report_sources` 为准、#707 未上线不画空图）、自评与 9 期重做计划。原型用 React + Tailwind + Radix 与 mock 数据做了 12 个页面（概览、连接质量、节点、节点详情、家宽出口、客户、客户详情、客户端、财务、设置 7 个分区、审计、设计规范），浅色/深色，面板级加载/出错/陈旧状态，`?telemetry=on` 预览 #707 面板。
- 工程与测试：原型是独立 Vite 入口，不进生产构建，也不进 `npm run lint` / `typecheck` 的范围；按控制台规则没有新增 Playwright 或 UI 单测。
- 验证：`npx tsc -p prototype/tsconfig.json --noEmit` 通过；`npx eslint prototype --max-warnings=0` 通过；生产控制台 `npm run typecheck`、`npm run lint` 通过；`npm run proto:build` 首屏 JS gzip 141.9 KB、全部 JS 172.0 KB（预算 400 / 600 KB）。截图在云端代理产物 `screenshots/after/`（35 张）与改前 `before-ops1/` `before-ops2/`。
- 候选/发布：无新包。
- 剩余限制：原型全是 mock 数据；文案沿用原型内联中文，搬进 `src/` 时要移到 `src/copy`；不能声称任何页面已接真接口。

### 续：第二轮，补到 9 分（同一 PR）
- 新增/优化：抽屉详情（失败码样本与拆分、时间线原始事件、审计改前改后与请求、事故经过与认领/静音/关闭、账本行与冲正、家宽换绑），对象写进 URL；⌘K 搜客户/节点/家宽/版本与操作，`/`、`J/K`、`G`+字母、`?` 快捷键；1280 / 1024 / 768 以下三档布局（图标栏、收列、汉堡菜单）；表单、抽屉、三级确认（输入名字 + 任务步骤 + 失败重试）、提示、键盘、断点、对比度写进 `/design`；财务柱图纵轴刻度；设置各分区的编辑流程；节点探测/重启/下架确认与进度；开通、导出、续期、停用、换节点、原始日志窗口、批量导入、版本校验与撤回、关账、记账流程。
- 缺陷修复（原型内）：未分层的全局 CSS（`button { color: inherit }`、`* { border-color }`、`:focus-visible`、`.sr-only`、`.field-input`）压过 Tailwind 工具类，导致深色主按钮文字 2.7 : 1、Select 背景重复、跳到正文不显示；已移进 `@layer base` / `@layer components`。浅色 faint/ok/warn 与深色 faint、深色危险按钮文字调到 ≥ 4.5 : 1。浮层关闭后焦点回到触发它的按钮或行。
- 验证：`npx tsc -p prototype/tsconfig.json --noEmit` 通过；`npx eslint prototype --max-warnings=0` 通过；生产 `npm run typecheck`、`npm run lint` 通过；`npm run proto:build` 首屏 JS gzip 155.9 KB、全部 205.4 KB；axe-core 4（临时装在 /tmp，不进仓库）在 21 个地址 × 浅深、1024 与 390 宽、25 个打开的浮层里 0 个问题。截图 `screenshots/after/`（页面 35、抽屉 14、流程 33、窄屏 15）。
- 剩余限制：仍是 mock 数据；自评 9 分指流程与状态画全，不代表真数据下验证过；手机宽度长表格横向滚动；文案仍内联，搬进 `src/` 时移到 `src/copy`。
