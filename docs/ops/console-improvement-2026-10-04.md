# Tono 运维后台对比与改进路线

本轮对照 shineliang/aiproxy 的管理后台，检查 Tono 旧 `/ops/`（ops1）、日常 `/ops2/` 和它们共用的 Worker 管理接口，并启动第一批改进。**判断：Tono 的主要短板是业务组织和操作闭环，不是 React 或 Cloudflare 不够好。先让已有能力成为好用的后台，再补读模型与报表；不再造 ops3。**

归属：[运维计划](plan-2026-09-11.md)；不推进客户发布门。Tono 起始源码 `a97c963e`，首批实现 `a4f9a818`（[#1377](https://github.com/raydocs/tono/pull/1377)，draft），外部仓库固定在 `5b03e26bba457205e74611964d45960e14a776bf`（2026-10-04 获取）。外部部分是源码审计，未运行其服务、未验证其生产质量，也不把它当安全标杆。Tono 页面验收使用本地夹具，不代表线上部署。未复制外部代码或引入依赖。

## 对照结果

| 方面 | aiproxy 的实际实现 | Tono 起始状态与结论 |
|---|---|---|
| 业务入口 | [导航清单](https://github.com/shineliang/aiproxy/blob/5b03e26bba457205e74611964d45960e14a776bf/internal/dashboard/assets/admin-navigation.js)按业务分模块，叶子带归属、角色与搜索别名 | ops1 有日常/配置分组；ops2 只有五个图标入口，十个业务页面堆进设置。账目、家宽资产、操作记录应按职责暴露，而不是要求记住“去设置找”。 |
| 工作台优先级 | [导航说明](https://github.com/shineliang/aiproxy/blob/5b03e26bba457205e74611964d45960e14a776bf/docs/admin-navigation.md)把常用业务入口和配置分开 | ops2 `HeroKpis` 在桌面间接挂载整块连接质量图，事故列表排在它后面；手机直接不挂载该图。事故与下一步操作才该占第一屏。 |
| 对象详情 | [共用账号读数](https://github.com/shineliang/aiproxy/blob/5b03e26bba457205e74611964d45960e14a776bf/internal/dashboard/account_readings.go)被不同列表复用，[账号工作台](https://github.com/shineliang/aiproxy/blob/5b03e26bba457205e74611964d45960e14a776bf/docs/account-workbench.md)集中状态、订阅、线路与动作 | Tono 已有客户 360、节点详情、时间线、设备诊断、跟进与回复草稿，不应重建。下一步是整理其摘要与动作优先级，沿用同一对象入口和事实来源。 |
| 报表扩展 | [reports.go](https://github.com/shineliang/aiproxy/blob/5b03e26bba457205e74611964d45960e14a776bf/internal/dashboard/reports.go)注册八类报表，统一描述列、筛选、时间范围与加载器 | Tono 有 SLO、节点成本、客户用量、月结和 CSV，但分散在页面。可借鉴声明式报表目录，不复制它的业务字段，也不把账务导出与运营报表混为一谈。 |
| 规模与读模型 | 共用读数和报表加载器减少页面自行拼口径 | Tono Worker **已**有 SQL 客户分页及状态/设备/服务的批量读取，旧计划“逐人查询尚未修”不是当前事实。但浏览器仍串行拉全量分页，最高 2000 项，App 每分钟刷新共享资源；要改的是页面按需读取、分页搜索与汇总口径，不是再修一遍旧 N+1。 |
| 权限与证据 | [roles.go](https://github.com/shineliang/aiproxy/blob/5b03e26bba457205e74611964d45960e14a776bf/internal/dashboard/roles.go)把页面可见性和写权限区分 | Tono 已有 Worker 角色门、动作确认、队列、审计、部分变更回执、批次未知结果。不能为“操作顺手”弱化这些约束；也不能因为有排队提示就声称设备执行完成。 |
| 可维护性 | 业务组织清晰，但 `internal/dashboard/index.html` 实测 33873 行 | Tono 的模块化 React、共享 DTO/checker、Measured、体积和文案棘轮值得保留。借鉴业务模型，不照搬单文件工程；“他看起来成熟”不等于所有代码都更好。 |

Tono 证据入口：`services/control-plane/admin/src/{main.tsx,hooks.tsx,pages/ControlPage.tsx}`；`services/ops-console/src/{app,pages,lib/api.ts,lib/use-resource.ts}`；`services/control-plane/src/ops/{customers-list.ts,handlers/customers.ts,contract,access-roles.ts}`。ops1 的目录/分流页面已经只读并跳转 ops2 发布，不恢复双写。ops2 的 `@legacy-lib` 仍有真实消费者，不按文件名删掉。

## 第一批已实现

1. 五个职责分组、14 个入口共用一份清单，桌面显示名称。家宽与账目直接可达，页头显示归属和真实功能名；去掉设置页重复的十项导航。
2. 侧栏、手机“更多”和全局搜索使用同一清单与原角色门。搜索支持财务、审计、服务器等别名，也保留页面名和英文标识。
3. 手机底栏保留今天/节点/客户/客户端，加带焦点约束的“更多”面板；搜索不再仅桌面可用。菜单可滚动、Esc 关闭后返回触发按钮。
4. 今天页顺序变为结论与读数 → 事故/待办与早报 → 趋势。手机也可查看趋势，1024px 下处理区采用单列，避免侧栏展开后挤压内容。

**未改变** `/ops/`、`#/today` 等页面链接和 `#/settings/*` 深链；未知设置节仍回到告警。未新增 API、迁移、权限、采集口径或写动作；不动 PF/WFP、身份、目录准入和 hy2 身份归并。

## 后续实施顺序和验收

这是本轮形成的路线，不是这些阶段已经完成的声明。每批独立交付，沿用现有运维计划的合同、测试、审查和部署门禁。

| 顺序 | 要改变的实际体验与代码范围 | 可证明完成的标准 |
|---|---|---|
| 第二批 工作台和对象工作区 | `pages/{Customers,CustomerDetail,NodeDetail}`、`pages/{customer,node}`：摘要先回答“谁受影响、什么证据、下一步是什么”；高频筛选与批次结果保持上下文。接续已有 [WF-1–WF-5](workflow-followups-2026-09-14.md)，不重做其已交付部分。 | 从事故到客户/节点、看证据、执行一个既有动作、核对本次回执、返回原列表的路径不丢对象/筛选/运行结果；只针对触及流程做浏览器验收。 |
| 第三批 按需查询和分页搜索 | `app/App.tsx`、`lib/api.ts`、`pages/Customers.tsx`、Worker `customers-list.ts`/handlers：列表按页读取，搜索在服务端；工作台计数不再依赖浏览器全员列表。新汇总合同先单独交付，再改消费者。 | 超过当前 2000 项上限仍可检索后段客户；计数与过滤列表同口径；不把未加载当没有；进入账目不拉完整客户历史；记录请求数、响应体和 D1 查询预算。不能靠只删 getAllJson 把后段客户藏掉。 |
| 第四批 运营报表和经营视图 | 先整理已有 SLO、用量、节点成本、月结接口，再做只读报表目录与统一筛选/列定义。账目财务语义不改。 | 同一时间窗口的页面数字和导出一致；缺测与零区分；可解释窗口、时区和来源；先落地客户用量/失败、节点质量/成本、到期清单，不照搬不属于 Tono 的模型和订阅池报表。 |
| 第五批 操作闭环与健康状态 | 在现有 `useWrite`、批次、jobs、receipts 上逐项补齐“受理/排队/执行/验证/未知”的呈现与关联；区分无权限、登录失效、源过期和刷新失败。需要后端语义改动的先出合同，并按风险独立审查。 | 页面使用本次动作 ID，不拿最近一条充数；结果未知不自动重复写；读取失败不显示空列表或健康；没有最终证据不标“执行成功”。既有确认和回执语义不被简化。 |
| 最后 旧入口收敛 | 核验运维计划 §6 的两周日常使用、真实事故和真实告警条件，清点兼容链接、legacy handler 与共享库消费者后，才安排迁移。 | 条件有可引用证据、每条旧路由有对应、回滚可用；共享库移动但行为不改。此次不删除 ops1，也不新增 ops3。 |

工程附项：`npm ci` 报告两项依赖审计问题（`brace-expansion` high，`next` critical；后者来自 Geist 的 Next peer 依赖）。这是依赖树信号，**不证明当前 Vite 静态页面暴露对应 Next 服务漏洞**。单独评估升级及构建影响，本批不自动改锁文件。

## 本轮验证与限制

2026-10-04，MacBook，本工作树：

- `npm run typecheck` 通过；noUncheckedIndexedAccess 棘轮输出 `unchecked indexed access errors 171 (baseline 219)`。
- `npm run lint` 通过。
- 最窄相关测试：7 文件、31 测试通过；控制台全量 `npm test`：44 文件、345 测试通过。
- `npm run build` 及预算通过：首屏 JS 202.0 KB / 400 KB gzip；全量 311.3 KB / 600 KB gzip；0 个源码文件超过 400 行。
- ego-browser：1600px 下14个入口，事故首行顶部约413px，趋势在其后；1024px dense 单列无横向溢出；390px 下5个底栏目标均高52px，首个事故动作在屏内，趋势仍挂载；320px 底栏完整无横向溢出，深色主题读数与入口正常。核验账目深链、审计别名搜索、历史后退、更多菜单14条、Esc焦点恢复、手机家宽跳转及财务搜索。
- 纯导航函数实测：viewer 仍只可见 today/customers/nodes/clients；operator 可见14项。是 UI 过滤证据，不替代 Worker 权限测试或线上角色验证。
- empty/error 夹具：空事故有明确提示；接口错误时四个 KPI 都是 `—`，不是零。未写新 UI 单测、Playwright 用例或重生成截图基线。
- 无 Worker 源码变更，未运行 Worker 测试；未运行全站 Playwright；未验证线上 Access 会话、真实告警或生产动作；未合并、未部署。UI PR 不启用自动合并。

截图均为夹具，不含生产数据：[改前桌面](evidence/2026-10-04-console-navigation/before-desktop.png)、[改后桌面](evidence/2026-10-04-console-navigation/after-desktop.png)、[改后手机](evidence/2026-10-04-console-navigation/after-phone.png)、[改后深色](evidence/2026-10-04-console-navigation/after-dark.png)。
