# 旧后台 `/ops/` 与新后台 `/ops2/` 功能对照

对照范围：旧后台 `services/control-plane/admin/src`（六页：总览 / 故障 / 服务器 / 客户 / 流量 / 目录和规则）对 新后台 `services/ops-console/src`（今天 / 节点 / 客户 / 客户端 / 设置）。接口前缀一律 `/api/v1/ops/`。路由分三处：legacy 在 `services/control-plane/src/ops/router.ts` + `legacy-handlers/`；两扇门共用写在 `shared-admin/`；v1 合同在 `handlers/dispatch.ts`（`OPS_V1_ROUTES`）。`src/index.ts` 先走 `sharedAdministrativeResource`，再 `opsRoutes`。

新后台已有、旧后台没有的面（客户端发布、告警规则、商家账号、直连候选、事故 ack/snooze）不列入缺口——那是引擎侧增量，不是替换障碍。

约定：`缺` = 新后台没有可点的面（接口往往已经在）。`不要搬` 见文末。

## 总表

| 旧后台功能 | 页面/组件 | 调用的接口 | 数据来源表 | 新后台对应 | 缺口说明 |
|---|---|---|---|---|---|
| KPI（用户/设备/机器/库存） | `pages/Dashboard.tsx` | GET `dashboard` | `users` `devices` `home_exits` `product_accounts` `ops_node_profiles` `managed_exit_catalog` `user_home_bindings` | `pages/Today.tsx` 待办碎片 | 独立计数条缺。接口在 `legacy-handlers/dashboard.ts` |
| 机房/路径事故（客户端拼快照） | `Dashboard.tsx` + `FailuresPage.tsx` | GET `live` `activity` `fleet-nodes` | `operations_live_snapshot` `telemetry_windows` | `Today.tsx` + `today/IncidentDrawer.tsx`：GET `incidents`，POST `…/ack\|snooze\|resolve\|notes` | **不要搬旧拼装**。引擎表 `ops_incidents`（`handlers/incidents.ts`）已替换 |
| 问题节点卡片 | `Dashboard.tsx` `NodeCard.tsx` | 同上 | 同上 + `ops_node_profiles` | `pages/Nodes.tsx` 筛选 | 覆盖 |
| 运营待办（额度/到期/目录落后） | `Dashboard.tsx` | GET `users` `activity` | `users` `telemetry_windows` | `Today.tsx` chores 页 | 覆盖（口径改成引擎） |
| 闲置家宽 / 闲置 Claude | `Dashboard.tsx` | GET `dashboard` | `home_exits` `product_accounts` | 缺 | 今天页加库存数字，或沿用 GET `dashboard` |
| 谁在线（最多 5） | `Dashboard.tsx` `users/PersonRow.tsx` | GET `activity` | `telemetry_windows` | `pages/Customers.tsx` 在线筛选 | 覆盖 |
| 节点占用 Top | `Dashboard.tsx` | GET `activity` `fleet-nodes` | `telemetry_windows` | `node/Occupants.tsx` | 机队占用条缺，详情有 |
| 客户本期用量 Top | `Dashboard.tsx` | GET `users` | `users` | `Customers.tsx` 额度列；`CustomerDetail.tsx` 配额条 | 独立流量页缺，见下 |
| 最近操作 | `Dashboard.tsx` | GET `audit` | `ops_audit` | `settings/Audit.tsx` | 覆盖（设置·审计） |
| 故障筛选：客户路径 / 路径未测 | `FailuresPage.tsx` | GET `activity` `live` | `telemetry_windows` `operations_live_snapshot` | `Today.tsx` 打开的事故 | 快照「未测」列表不要搬；引擎不把缺测当事故 |
| 从故障打开节点/客户抽屉 | `FailuresPage.tsx` | 见下抽屉 | — | 链到 `#/nodes/…` `#/customers/…` | 覆盖 |
| 服务器卡片/表格 + 筛选 | `MonitorPage.tsx` | GET `live` `fleet-nodes` `node-profiles` `activity` `exit-catalog` | `operations_live_snapshot` `ops_node_profiles` `managed_exit_catalog` `telemetry_windows` | `Nodes.tsx` `NodeCardGrid.tsx` | 覆盖。新页也拉 GET `live`（`lib/use-fleet.ts`） |
| 机队处理队列 | `MonitorPage.tsx` FleetQueue | 同上 | 同上 | `Nodes.tsx`「需处理」筛选 | 覆盖 |
| 机器负载表 | `MonitorPage.tsx` MachinePressure | GET `live` | `operations_live_snapshot` | `node/Facts.tsx` 单机 | 全集负载表缺。不必单独搬，详情够用 |
| 全机队 24h 趋势 | `MonitorPage.tsx` AgentTrends | GET `metrics?range=24h` | `operations_agent_samples` `operations_agent_rollups` | 缺 | 节点详情无 CPU/内存曲线。接口在 `legacy-handlers/metrics.ts` |
| 补账单资料（新建档案） | `MonitorPage.tsx` BillingCreate | POST `node-profiles` | `ops_node_profiles` | 缺 | 设置或节点详情要表单。`shared-admin/product-accounts.ts` |
| 节点抽屉：状态/资源/占用 | `monitor/NodeDrawer.tsx` | GET `live` `fleet-nodes` `activity` | 同上 | `NodeDetail.tsx` `node/Header.tsx` `Facts.tsx` `Occupants.tsx` | 覆盖 |
| 三网与大陆可达 | `NodeDrawer.tsx` `carriers.tsx` | GET `live` | `operations_live_snapshot` | `node/Paths.tsx` + `lib/carriers.ts` | 覆盖（回程三网已接 live） |
| 单机 24h 趋势 | `NodeDrawer.tsx` NodeTrends | GET `metrics` | `operations_agent_samples` | 缺 | 同「全机队趋势」 |
| 端口与风险 + 线路原文 | `NodeDrawer.tsx` QualityTextFold | GET `fleet-nodes/{name}/quality-text` | `operations_live_snapshot`（按需切原文） | 缺 | 节点详情抽屉加折叠。`legacy-handlers/fleet-nodes.ts` |
| 账单档案表单（改套餐/续费/新账期） | `NodeDrawer.tsx` BillingForm | POST/PUT `node-profiles` `node-profiles/{id}` | `ops_node_profiles` | `Facts.tsx` **只读** | 要可写区块。接口已在 |
| 预览下架 / 确认下架 | `NodeDrawer.tsx` RetireZone | GET `fleet-nodes/{name}/retire-preview`；POST `…/retire` | `managed_exit_catalog` `ops_node_profiles` `telemetry_windows` | `node/ActionRail.tsx` | 覆盖 |
| 客户列表 + 筛选/搜索 | `UsersPage.tsx` `users/CustomerList.tsx` `PersonRow.tsx` | GET `users` `activity` | `users` `telemetry_windows` `user_home_bindings` `home_exits` `product_accounts` | `Customers.tsx`：GET `customers` | 覆盖。**不要再接** GET `users` |
| 开通客户 | `users/OnboardDrawer.tsx` | POST `users/onboard` | `signup_allowlist` `users` `home_exits` `user_home_bindings` `product_accounts` `device_exit_credentials` | 缺（客户页无开通按钮） | 客户页抽屉。`legacy-handlers/users.ts` |
| 批量：给落后客户刷目录 | `UsersPage.tsx` CohortActions | POST `device-actions` `{action:refresh_catalog}` | `device_actions` `devices` | 缺 | 客户列表工具条。`shared-admin/device-actions.ts` |
| 批量：将到期客户续 30 天 | `UsersPage.tsx` CohortActions | PATCH `users/{id}` `{expiresAt}` | `users` | 缺 | 同上。`legacy-handlers/users.ts` |
| 客户抽屉头：在线/用量/家宽 | `users/CustomerDrawer.tsx` | GET `users` `users/{id}/detail` | `users` `user_home_bindings` | `CustomerDetail.tsx` 头 | 只读覆盖；头上四个按钮写死「接口未接入」（`copy/customers.ts`） |
| 路径诊断（出口/TCP/目录落后） | `users/CustomerDiagnostics.tsx` | GET `activity` `exit-catalog` | `telemetry_windows` `managed_exit_catalog` | `CustomerDetail.tsx`「现在」 | 覆盖 |
| 改到期 / 续 30 天 / 取消到期 | `users/CustomerOperations.tsx` | PATCH `users/{id}` `{expiresAt}` | `users` | 头按钮「改到期」禁用 | 客户详情抽屉。接口已在 |
| 本期用量清零 | `CustomerOperations.tsx` | PATCH `users/{id}` `{resetUsage:true}` | `users` | 缺 | 账务折叠。接口已在 |
| 贴线路 / 库存绑 / 解绑家宽 | `CustomerOperations.tsx` | POST `home-exits/assign`；PUT/DELETE `users/{id}/home-binding` | `home_exits` `user_home_bindings` | 缺 | 客户详情「家宽」节。`shared-admin/home-exits.ts`。设置里的 `home-lines` **不是**这条绑路（只改账单字段） |
| Claude 开通 / 换号 / 封号 | `CustomerOperations.tsx` ClaudeBlock | GET/POST `product-accounts`；POST `…/{id}/replace` `…/{id}/ban` | `product_accounts` `product_account_events` | 缺 | 客户详情折叠。`shared-admin/product-accounts.ts` |
| 联系与备注 | `CustomerDrawer.tsx` ContactSection | PATCH `users/{id}` `{contact,notes}` | `users` | 缺 | 客户详情。接口已在 |
| 受保护路由证据（只读） | `CustomerDrawer.tsx` ProtectedRouteProofSection | GET `users/{id}/detail` | `device_actions` `telemetry_windows` | 缺 | 只读块。可挂详情。`legacy-handlers/users.ts` |
| 设备：诊断 / 流量快照 / 刷新节点 / 重试断线保护 | `CustomerDrawer.tsx` DeviceButtons | POST `device-actions`；GET `device-actions?deviceId=` | `device_actions` `devices` | `customer/Devices.tsx` 按钮全禁用 | 设备行动作。接口已在。动作枚举：`diagnostic_snapshot` `claude_traffic_snapshot` `refresh_catalog` `retry_protection` |
| 设备吊销 | `DeviceButtons` | DELETE `devices/{id}` | `devices` `revocation_jobs` | 缺 | 设备行。`shared-admin/device-actions.ts` |
| 诊断报告 JSON | `CustomerDrawer.tsx` DiagnosticReport | GET `users/{id}/detail` | `diagnostics_reports` | 缺 | 详情折叠。新 360 没有这份原文 |
| 注销 / 恢复账号 | `CustomerDrawer.tsx` 危险操作 | POST `users/{id}/close`；PATCH `users/{id}` `{status}` | `users` `signup_allowlist` `user_home_bindings` `product_accounts` `devices` | 头「停用」禁用 | 危险区。close 在 `shared-admin/catalog.ts` |
| 家宽库存：批量导入 | `users/HomesInventory.tsx` | POST `home-exits/import` | `home_exits` | 缺 | 设置新节或客户页旁路。**不要**复用 `settings/HomeLines.tsx`（无 socks5 口令、无导入） |
| 手动登记线路 | `HomesInventory.tsx` | POST `home-exits` | `home_exits` | 缺 | 同上 |
| 启用 / 停用 / 删除家宽 | `HomesInventory.tsx` | PATCH/DELETE `home-exits/{id}` | `home_exits` | `HomeLines.tsx` 能删（退役）不能停用/改口令 | 库存操作要接 `home-exits`，不是 `home-lines` |
| 家宽探测状态 | `HomesInventory.tsx` | GET `home-exits`（含 probe 聚合） | `home_exits` `operations_home_probe_samples` | `HomeLines.tsx` 探测列 | 部分覆盖；GET `home-exits/{id}/probes` 旧 UI 未用 |
| 机器流量总览 + Top | `TrafficPage.tsx` | GET `metrics?range=` | `operations_agent_samples` `operations_agent_rollups` | 缺 | 独立页或节点详情曲线。`legacy-handlers/metrics.ts` |
| 客户本期累计 | `TrafficPage.tsx` | GET `users` | `users` | `Customers.tsx` 额度 | 列表够用，不必单独页 |
| 客户小时用量 | `TrafficPage.tsx` | GET `usage-hours?range=` | `operations_user_usage_hours` `users` | `CustomerDetail.tsx` 使用时段（另一套 `customers/{id}/activity`） | 机队小时合计缺。接口在 `legacy-handlers/usage-hours.ts` |
| 发布概况（目录/规则/客户端落后） | `ControlPage.tsx` | GET `exit-catalog` `traffic-policy` `activity` | `managed_exit_catalog` `managed_traffic_policy` `telemetry_windows` | `settings/Catalog.tsx` **路牌**，链回 `/ops/` | 设置·目录要编辑器 |
| 节点目录 YAML 编辑/diff/发布 | `ControlPage.tsx` | GET/PUT `exit-catalog` | `managed_exit_catalog` `operations_catalog_revision_metadata` | 缺（明确不双开） | 设置节。`shared-admin/catalog.ts`。409 要保留 |
| 直连规则 JSON 编辑/签名发布 | `ControlPage.tsx` | GET/PUT `traffic-policy` | `managed_traffic_policy` | `settings/Candidates.tsx` 只能出草稿 POST `traffic-policy/draft-from-candidates` | 缺发布。PUT 在 `shared-admin/traffic-policy.ts` |
| 关闭网页直连 / 关掉全部直连 | `ControlPage.tsx` | PUT `traffic-policy`（改草稿再发） | `managed_traffic_policy` | 缺 | 编辑器里的快捷，不必独立页 |
| 目录历史（sha/台数，无原文） | `ControlPage.tsx` | GET `catalog-revisions` | `operations_catalog_revision_metadata` `managed_exit_catalog` | 缺 | 目录编辑器旁折叠。`router.ts` → `reads/catalog-revisions.ts` |
| 顶栏：搜节点/客户、隐私、主题、刷新 | `main.tsx` | 本地 + 已拉资源 | — | `app/Shell.tsx` `CommandPalette.tsx` | 覆盖。不要搬旧顶栏 |

旧后台 **API 有、页面没有**（仍算缺口，因为关 `/ops/` 后没入口）：

| 功能 | 接口 | 表 | 新后台 | 说明 |
|---|---|---|---|---|
| 注册白名单增删查 | GET/POST/DELETE `signup-allowlist` | `signup_allowlist` | 缺 | 开通会 INSERT。独立名单页旧也没有。GET/DELETE：`legacy-handlers/signup-allowlist.ts`；POST：`shared-admin/catalog.ts` |
| 诊断日志访问窗口 | GET/PUT/DELETE `users/{id}/devices/{id}/diagnostics-logs` | `diagnostics_log_access` `devices` | 缺 | 旧抽屉也没做。`shared-admin/diagnostics-logs.ts`，最长 24h |
| exit 节点令牌轮换 | GET/POST `exit-nodes`；POST `exit-nodes/{id}/token`；PATCH `exit-nodes/{id}` | `exit_nodes` | 缺 | 旧 UI 无。`shared-admin/exit-nodes.ts` |
| 设备凭证 rollout | GET/POST `exit-credential-rollout` | `exit_credential_rollout` `device_exit_credentials` `devices` `exit_nodes` | 缺 | 一次性切换。旧 UI 无 |
| 计量 v2 rollout | GET/POST `usage-metering-rollout` | `usage_metering_cutover_baselines` `usage_report_sources` `users` `exit_nodes` | 缺 | 一次性切换。旧 UI 无 |
| 节点占用事故（未接线） | GET `incidents/node/{name}` | `telemetry_windows` | 不要搬 | 旧 `api.ts` 有、页面未调。新用 GET `incidents/{id}` |

## 缺口分组

### (a) 客户管理动作

| 缺口 | 已有路由 | 新后台要什么 |
|---|---|---|
| 开通 | POST `users/onboard`（`legacy-handlers/users.ts`） | `Customers.tsx` 开通抽屉，对标 `OnboardDrawer.tsx` |
| 改字段（备注/联系/套餐） | PATCH `users/{id}` | `CustomerDetail.tsx` 可编辑节 |
| 停用/恢复 | POST `users/{id}/close`；PATCH `users/{id}` `{status}` | 详情危险区（解开头上的禁用按钮） |
| 改到期 / 续 30 天 / 清零用量 | PATCH `users/{id}` `{expiresAt\|resetUsage}` | 详情账务节 + 列表批量条 |
| 设备吊销 | DELETE `devices/{id}` | `customer/Devices.tsx` 行内 |
| 家宽绑定/解绑/换线 | POST `home-exits/assign`；PUT/DELETE `users/{id}/home-binding` | 详情「家宽」节（**不要**接到 `home-lines`） |
| 远程诊断动作队列 | POST/GET `device-actions` | 设备行四个动作；解开 `PLATFORMS_WITH_ACTIONS = []` |
| 诊断日志访问窗口 | GET/PUT/DELETE `users/{id}/devices/{id}/diagnostics-logs` | 设备行「开 24h 日志」；旧页也没有，但关 `/ops/` 前要有入口 |
| 注册白名单 | GET/POST/DELETE `signup-allowlist` | 开通已写入。独立名单：设置一小节即可，非关停阻断 |

Claude 号池（开通/换号/封号）也是客户动作，接口 `product-accounts*`，详情折叠。

### (b) 目录与规则

| 缺口 | 已有路由 | 新后台要什么 |
|---|---|---|
| 目录 YAML 读/写/冲突 | GET/PUT `exit-catalog` | 替换 `settings/Catalog.tsx` 路牌：编辑 + diff + 确认发布 |
| 发布历史 | GET `catalog-revisions` | 目录节折叠（只有摘要，无历史原文——旧页也载不了非当前版） |
| 直连规则读/写/签名 | GET/PUT `traffic-policy` | 设置·规则编辑器；候选草稿已有，缺对照发布 |
| 家宽登记/导入 | POST `home-exits` `home-exits/import` | 设置新节「家宽库存」，与 `HomeLines.tsx` 账单并列 |
| 家宽分配 | POST `home-exits/assign` + 绑定 PUT | 见 (a)，挂客户详情 |

`settings/Candidates.tsx` 的接受/拒绝/出草稿留下；发布必须走 PUT `traffic-policy`。

### (c) 节点

| 缺口 | 已有路由 | 新后台要什么 |
|---|---|---|
| 下架预览/确认 | GET `…/retire-preview`；POST `…/retire` | **已有** `ActionRail` |
| 节点档案读写 | GET/POST `node-profiles`；PUT `node-profiles/{id}` | 节点详情可写「账单」；列表「补档案」 |
| exit 令牌轮换 | POST `exit-nodes/{id}/token` 等 | 设置·机房折叠，或继续 curl。旧 UI 本无 |
| 凭证 rollout | GET/POST `exit-credential-rollout` | 一次性。建议 **不要做页**，文档 + curl |
| 计量 rollout | GET/POST `usage-metering-rollout` | 同上 |

新后台多出来的节点动作（下架目录/重新上架/同步身份/拉错误/重启 Xray/再探）走 POST `nodes/{name}/jobs`，旧后台没有，不算缺口。

### (d) 只读视图

| 缺口 | 已有路由 | 新后台要什么 | 搬否 |
|---|---|---|---|
| dashboard 计数 | GET `dashboard` | 今天页一行库存数字即可 | 要数字，不要第六页 |
| failures 页 | （客户端拼 `live`+`activity`） | `Today.tsx` 已接引擎 | **不要搬** |
| traffic 页 | GET `metrics` `usage-hours` | 节点详情曲线 + 可选「流量」页 | 曲线要；独立页可后做 |
| live 三网 | GET `live` | `Nodes`/`Paths` 已接 | 覆盖 |
| metrics | GET `metrics` | 节点详情 24h 折线 | 要 |
| usage-hours | GET `usage-hours` | 可不做机队合计；客户侧已有 `customers/{id}/activity` | 低优先 |
| catalog-revisions | GET `catalog-revisions` | 目录编辑器旁 | 随 (b) |

## 不要搬

- **故障页客户端拼事故**（`admin/src/lib/incidents.ts`）：引擎 `ops_incidents` + 今天页已替换；再搬会两套口径。
- **GET `users` / GET `dashboard` 当主列表**：新合同是 GET `customers`。dashboard 只留库存数字。
- **GET `incidents/node/{name}`**：旧页面没调。
- **GET `devices`、GET `home-bindings` 全量列表**：旧页面没调。
- **设置·目录做成第二套 YAML 编辑器却不关旧页**：`settings/Catalog.tsx` 写明双开会把机队撕开。搬的时候必须换掉路牌，只留一处发布。
- **把 `home-lines` 当成家宽库存**：`handlers/assets.ts` 的 `home-lines` 改的是 `home_exits` 的账单列（ISP/价格/账期），没有 socks5 口令、没有绑定。绑路必须走 `home-exits*`。
- **凭证/计量 rollout 做成日常页**：一次性、有阻断条件，适合 curl + `docs/ops/rollout-ops2.md`，不做按钮防误点。
- **旧顶栏隐私/主题/自动刷新**：新壳已有。
- **「关闭网页直连」独立页**：规则编辑器里的快捷即可。

## 三波（关 `/ops/` 的顺序）

**第 1 波 · M · 客户写动作。** 没有这些就不能关客户页。做：开通抽屉、到期/停用/恢复/清零、家宽绑/换/解、Claude 号、设备四动作 + 吊销、联系备注。全是已有 `/api/v1/ops/*`，新页接上即可。顺手把客户头四个禁用按钮接到真接口。诊断日志窗口一并做（接口现成）。

**第 2 波 · L · 目录、规则、家宽库存。** 关 `ControlPage.tsx` + `HomesInventory.tsx`。做：设置·目录 YAML（含 409/diff/历史摘要）、直连规则发布（接上候选草稿）、家宽库存节（导入/登记/停用，走 `home-exits`，与 `HomeLines` 账单并列）。这波动生产目录，要确认框和基线修订。

**第 3 波 · S · 节点档案与只读收尾。** 节点详情可写账单（`node-profiles`）、质量原文折叠、24h metrics 折线；今天页补库存数字。流量独立页、usage-hours 机队合计、白名单名单页、exit 令牌轮换：S 或继续 CLI。rollout 两件明确不做页。

做完第 1+2 波，日常开通/下架/发目录不再打开 `/ops/`。第 3 波之后旧六页可以摘导航。
