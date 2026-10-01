# 运维后台重做：信息架构、设计规范与分期计划

归属：[运维计划](plan-2026-09-11.md)（不是 ship gate）。状态：第二阶段设计稿，等所有者评审后再动 `src/`。
原型：`services/ops-console/prototype/`（独立 Vite 入口，mock 数据，不碰生产控制台代码）。

```sh
cd services/ops-console
npm run proto      # http://localhost:5175/ops/ ；npm run proto:build 出 dist/prototype
# 地址参数：?range=1h|24h|7d|30d  ?data=loading|stale|error  ?telemetry=on（预览 #707 上线后的面板）
```

## 1. 决定

- 只留一个后台：`services/ops-console` 的代码，挂在 `/ops/`；旧 `/ops2/` 与旧 `/ops/` 书签都跳到新地址。
- `services/control-plane/admin`（Ops 1）在功能对齐后下线；在那之前不删目录，因为 Ops 2 还通过
  `@legacy-lib` 引用 `admin/src/lib`。
- 目录与分流规则只有一个写入点（新后台 设置 → 目录 / 分流规则）；Ops 1 的 PUT 已在 [#713](https://github.com/raydocs/tono/pull/713) 拿掉。

## 2. 信息架构

每个一级页面先回答一个问题，再给证据。侧栏四组，最多两级；⌘K 能直接跳到页面、节点和客户。

```mermaid
flowchart LR
  subgraph 概览
    H["概览<br/>现在能不能连上？坏了什么？影响谁？"]
  end
  subgraph 运行
    O["连接质量<br/>成功率 · p50/p95 · 失败码 · 每节点三网"]
    N["节点<br/>全机队 CPU/内存/负载/流量 + 表"]
    ND["节点详情<br/>曲线 · 三网 · 最近客户 · 操作记录"]
    R["家宽出口<br/>健康 + 库存 + 绑定 + 费用 一张表"]
  end
  subgraph 客户
    C["客户<br/>状态筛选 · 每小时用量 · 游标分页"]
    CD["客户详情<br/>现在怎样 · 时间线 · 用量 · 设备 · 账务 · 原始日志窗口"]
    CL["客户端<br/>版本覆盖 · 每版成功率 · 发布记录"]
    F["财务<br/>收入 · 成本构成 · 续费 · 账本 · 关账"]
  end
  subgraph 管理
    S["设置<br/>目录 · 分流规则 · 告警 · 直连候选 · 商家 · 注册名单 · 角色"]
    A["审计<br/>谁 · 何时 · 做了什么"]
    D["设计规范"]
  end
  H --> O & N & C
  O -->|失败码 / 节点| ND
  O -->|受影响客户| CD
  N --> ND
  ND -->|最近客户| CD
  C --> CD
  CD -->|家宽| R
  R -->|绑定客户| CD
  CL -->|版本| C
  F -->|续费| CD
  S -.->|每次发布| A
```

| 页面 | 首屏回答 | 主要数据源 |
| --- | --- | --- |
| 概览 | 严重故障数、受影响客户数，一句话结论；今天要做的事 | `ops_incidents` `ops_customer_status` `connection_events` `operations_live_snapshot` |
| 连接质量 | 成功率是否达标、慢在哪、为什么失败；SLO 从 设置→账本 挪到这里 | `ops_connection_daily` `connection_events` `ops_daily_slo` |
| 节点 | 哪台坏、哪台忙、哪台不值 | `operations_agent_samples` `operations_live_snapshot` hub 探针 |
| 家宽出口 | 能不能用、给了谁、花多少、何时续费（取代「家宽库存」「家宽资产」两页） | `home_exits` `operations_home_probe_samples` |
| 客户 / 详情 | 谁连不上、谁快到期、这位客户此刻怎样 | `ops_customer_status` `operations_user_usage_hours` `ops_ledger_entries` |
| 客户端 | 新版覆盖了多少、哪一版在出问题 | `client_releases` `ops_device_status` |
| 财务 | 本月收支、毛利、要续费的人 | `ops_ledger_entries` `usage_report_sources` |
| 设置 / 审计 | 线上是什么、谁改的 | `managed_exit_catalog` `managed_traffic_policy` `ops_audit` |

## 3. 必须照着设计的数据事实

- `connection_events.edge_*` 是 用户→Cloudflare 那一段，不是回程线路。页面只按「客户端上报的运营商」分，
  并在图下写明；不画「回程线路」。
- Activity 的字节数从来没写入（#403）：用量一律来自 `operations_user_usage_hours` / `usage_report_sources`，
  计费以 `usage_report_sources` 为准，页面写出这一句。
- #707（迁移 0093：`failure_clusters` `client_sessions` `chain_hops` `dns_checks` `ai_service_routes`
  `session_exit_observations`）没上线前，连接质量页底部只放一行一行的「未接入」说明，不画空图；
  `?telemetry=on` 展示上线后的面板（每跳握手、DNS 漂移、AI 服务出口、失败聚类）。
- 「今天要做」用 Worker 的阈值（用量 ≥ 80%、7 天内到期）。正式版由 Worker 返回阈值，客户端不再各算一份。
- 列表不设 2000 上限：服务端游标分页，页脚写「服务端游标分页，不设上限」。
- 「标记直连」目前后端没接：正式版要么接上 `direct-candidates/{etld1}/accept`，要么不显示按钮；不再出现「接口未接入」。

## 4. 设计规范（原型 `/design` 页可交互查看）

- **字体**：Geist / Geist Mono + 系统中文字体；数字一律等宽数字（`.num`）。字号 11 / 12 / 14 / 20 / 24 / 32，
  分别用于坐标轴、表格、正文、页面标题、统计数字、首页结论。
- **间距**：4 的倍数；面板内边距 16，面板间距 16；表头 32、行高 40。圆角 4 / 6 / 8 / 12。
- **颜色**：浅色与深色两套 CSS 变量（`bg panel panel-2 hover line line-strong fg muted faint accent accent-fg`），组件只引用变量。
  状态色五种且只表达状态：正常（绿）、注意（橙）、故障（红）、信息（蓝）、闲置（灰），每种带一个浅底色。
  序列色 c1–c6 只用来区分线条，不表达好坏。
- **对比度**（WCAG AA，按正文 4.5 : 1 算，状态色也一样）：浅色 fg 18.0、muted 6.6、faint 5.6、ok 6.0、warn 5.6、sev 5.7、
  info 6.7；深色 fg 16.0、muted 7.6、faint 5.5、ok 9.6、warn 9.2、sev 5.8、info 6.9；主按钮文字 `accent-fg` 5.5 / 6.1。
  选中行底色上 faint 仍 ≥ 4.6。自定义 CSS 一律放进 `@layer base` / `@layer components`，否则会压过 Tailwind 工具类
  （原型里 `button { color: inherit }` 曾让深色主按钮文字只有 2.7 : 1）。
- **面板**：每块数据都是一个 Panel，标题栏右侧写数据源和新鲜度。加载、出错、陈旧由面板自己处理：
  一个接口慢或挂，只影响那一块；出错时不显示旧数字；陈旧超过阈值变橙并写「已陈旧」。
  首页结论在读不到 `connection_events` 时显示「现在判断不了」，永远不在没数据时说「一切正常」。
  横向可滚但里面没有可聚焦元素的面板自动加一个 tab 停靠点。
- **空与未接入**：空列表给一句原因；没数据源的指标用「未接入」一行说明，不画空图。
- **图表**：自绘 SVG，一套组件：`LineChart`（多序列、面积/虚线、目标线、事故阴影、十字准星悬停读数、空值断线）、
  `Bars`（堆叠、悬停读数、可选纵轴取整刻度与虚线网格）、`Spark`、`ProbeStrip`（缺测画斜线，不当成失败）、`Heatmap`、`Meter`。
  每张图 `role="img"` 并带一句读屏摘要（最新值、合计）。不引图表库：组件零依赖、合计不到 400 行。
- **表单**：标签在上、说明在标签下，出错时错误替换说明；`Field` 把 `id`、`aria-invalid`、`aria-describedby` 接到输入框。
  高 32、圆角 6、焦点环 2 px 强调色；失焦或提交后才显示错误；有错误时提交按钮禁用。控件：`Input` `Textarea` `Select`
  `Switch`（role=switch）`Checkbox`（表头可半选）。密码与 API key 不进表单，走 Worker secret。
- **抽屉**：看详情用抽屉，列表留在背后。右侧滑出，520 px 放一条记录，720 px 放带表格的记录，640 以下全宽；
  头（标题、一行说明、徽章）/ 身（分节）/ 脚（右对齐按钮）。抽屉的对象写进 URL（`#/observe?code=…`、
  `#/customers/u-002?event=1`、`#/audit?id=…`、`#/?incident=…`、`#/finance?entry=…`），能贴到群里，打开关闭不留历史；
  焦点进抽屉，关闭后回到触发它的那一行。
- **确认**：三级。普通（一次点击）、危险（红按钮 + 影响清单）、不可逆（先输入对象名：下架节点、停用客户、关账、撤回版本）。
  确认后同一个框里显示任务步骤；进行中不能关；失败停在那一步、写明下一步该做什么并给「重试」。
- **提示**：右下角，3 秒，最多 3 条，`role=status`；只报结果。
- **键盘**：⌘K 搜客户（邮箱、微信号）、节点（城市、商家、IP）、家宽（编号、IP 段）、版本与操作；`/` 聚焦本页搜索；
  `J/K`（选中后也可 ↑↓）在表格行间移动，Enter 打开；`G` 再按 H/Q/N/R/C/L/F/S/A 跳页；`?` 看全部快捷键；
  输入时和打开浮层时快捷键不触发。首个 Tab 是「跳到正文」。
- **断点**：≥ 1280 完整侧栏；1024–1279 图标栏并隐藏低优先列；768–1023 再隐藏 sparkline、签名、说明列；
  < 768 汉堡菜单滑出、时间范围收进「原型控制」、统计卡片 2 列、抽屉全宽。

## 5. 截图

- 改前：`/opt/cursor/artifacts/screenshots/before-ops1/`（Ops 1）、`before-ops2/`（Ops 2，含深色）。
- 改后：`/opt/cursor/artifacts/screenshots/after/`：12 个页面各一张浅色、一张深色；
  `13-observe-707-on`、`14-home-loading`、`15-home-stale`、`16-nodes-error`、`16b-home-error`、`17`–`22` 设置各分区。
  `after/drawers/`：失败码样本、时间线原始事件、审计请求差异、事故、账本行、家宽换绑与 ⌘K 定位（浅色 + 深色）。
  `after/flows/`：重启进度与失败、下架（输入名字）与完成、批量探测、续期、停用、原始日志窗口、开通（校验错误）、
  导出字段、批量导入校验、版本校验进度、撤回、关账、记账（校验错误）、分流规则编辑 + 预演 + 非法 JSON、目录发布、
  告警规则、注册名单、⌘K、快捷键表、键盘选中行、跳到正文。`after/responsive/`：1024、768、390 三个宽度。

## 6. 自评（原型，mock 数据）

第二轮（2026-09-30）。axe-core（wcag2a / wcag2aa / best-practice）在 21 个地址 × 浅深两套、1024 与 390 宽、
以及 25 个打开的抽屉/确认框里都是 0 个问题。

| 页面 | 第一轮 | 现在 | 这一轮补了什么 | 离 10 分还差 |
| --- | --- | --- | --- | --- |
| 概览 | 8.5 | 9 | 事故抽屉（信号、受影响客户、经过、认领/静音/关闭并写原因）；窄屏结论卡 | 结论句要按真实分布定模板 |
| 连接质量 | 8.5 | 9 | 失败码抽屉：建议、24 小时曲线、按节点/客户端/运营商拆分、12 条样本、原始错误 | #707 面板要用真数据校准 |
| 节点 | 8 | 9 | 批量选择与批量探测；1280 以下收列 | 批量重启刻意不做 |
| 节点详情 | 7.5 | 9 | 探测、重启、下架都走确认 + 进度；下架要输入节点名并列出影响；被墙节点重启后复测失败并建议下架 | 真实任务要轮询 `ops_node_jobs` |
| 家宽出口 | 8 | 9 | 换绑/绑定抽屉（搜客户、Claude 跟随）；批量导入逐行校验；登记表单；⌘K 定位高亮 | 商家接口自动续费不在范围 |
| 客户 | 8 | 9 | 开通表单（邮箱校验、查重）；导出字段选择；筛选写进 URL 可分享 | 自定义保存视图 |
| 客户详情 | 8.5 | 9 | 时间线点开看原始事件；跟进记录；续期、停用、换节点、原始日志窗口都有完整流程 | 跟进记录要落表 |
| 客户端 | 7.5 | 9 | 校验并发布的五步进度；撤回要输入版本号；登记新版本表单（sha256 校验） | 分阶段放量 |
| 财务 | 7.5 | 9 | 两张柱图加纵轴刻度；关账清单 + 输入月份 + 步骤；记账表单；账本行抽屉与冲正 | 月报导出 |
| 设置 | 7 | 9 | 目录发布确认与步骤；分流规则 JSON 编辑、即时校验、差异、预演、发布，止血开关；告警规则新建/编辑/测试；直连候选接受/拒绝/撤销并生成草稿；商家账号增改；注册名单增删；窄屏横向分区导航 | 角色矩阵只读 |
| 审计 | 7.5 | 9 | 行点开：改前改后、方法与路径、请求 ID、来源、原始记录 | 按请求 ID 串起同一次操作 |
| 设计规范 | 8 | 9.5 | 表单、抽屉、三级确认、提示、键盘、断点、对比度表都有规范和可点的例子 | — |

全局：⌘K、页面跳转与表格键盘导航、1280 以下三档布局、焦点可见与回位、图表读屏摘要。
诚实的限制：全是 mock 数据，9 分是「流程和状态都画全了」，不是「在真数据下验证过」；手机宽度下长表格仍是横向滚动。

## 7. 分期重做计划（G4 冻结解除后，每期一个 PR）

每期都在 `src/` 里做，遵守现有规则：中文文案只进 `src/copy`，数字只在 `components/ops` 与 `lib/display` 格式化，
文件 ≤ 400 行，首屏 ≤ 400 KB gzip；不新增 Playwright 或 UI 单测，只更新受影响页面的现有截图基线。

1. **地基**：把 tokens、Panel/状态组件、图表组件搬进 `src/components/ops`；深色模式。页面不变。
2. **挂到 `/ops/`**：Worker 静态路径改为 `/ops/`，`/ops2/*` 与旧 `/ops/#/…` 路由 301 到新地址；Ops 1 入口先保留在 `/ops/legacy/`。
3. **概览 + 连接质量**：结论卡、今天要做（阈值改由 Worker 返回）、SLO 从 设置→账本 移到连接质量。
4. **节点 + 节点详情**：补齐 Ops 1 的全机队 24 小时曲线。
5. **客户 + 客户详情**：服务端游标分页取代 2000 上限；每小时用量；原始日志窗口（`customers.raw-logs`，依赖 [#716](https://github.com/raydocs/tono/pull/716)）。
6. **家宽出口**：合并「家宽库存」「家宽资产」；闲置家宽与 Claude 账号计数；接上或去掉「标记直连」。
7. **客户端 / 财务 / 设置 / 审计**：按原型重排；Ops 1 独有的完整诊断 JSON 放进客户详情的折叠区。
8. **#707 面板**：迁移 0093 部署后打开连接质量页的诊断区。
9. **下线 Ops 1**：把 `@legacy-lib` 用到的代码搬进 ops-console，删 `services/control-plane/admin`，删 `/ops/legacy/`，更新 `parity-audit.md`。
