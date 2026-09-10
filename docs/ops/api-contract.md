# Tono Ops API 合同

`/api/v1/ops/*` 的类型与运行时检查都在 `services/control-plane/src/ops/contract.ts`（按主题拆在 `src/ops/contract/*.ts`），
共用的 HTTP 约定在 `src/ops/http.ts`。控制台通过 tsconfig 路径 `@contract` 引用同一份文件——不做代码生成，不用 schema 库。

## 五条约定

| 约定 | 规则 |
|---|---|
| 列表信封 | `{ items, nextCursor, total?, updatedAt }`。数不出来就**不给** `total`（不是 `null`）。用 `listEnvelope()` 构造，`assertList()` 检查。 |
| 游标 | base64url 的 `sortKey:id`。`sortKey` 不含冒号，`id` 可以（节点名是中文，也是 id）。`parseCursor()` 对垃圾游标返回 400，绝不静默回到第一页——那和"列表少了一截"长得一样。 |
| `?since=` | 秒级 epoch，给廉价轮询用。非法值 400。 |
| 弱 ETag | 由版本元组算出（一般是 `MAX(updated_at)` 与 `COUNT(*)`）：`weakEtag([...])`。**在任何其他查询之前**调 `notModified(req, etag)`，命中就 304。响应走 `jsonWithEtag()`，`cache-control: no-store` 不变。 |
| `Measured<T>` | 页面上渲染的每个数字都是 `{ value, asOfSec, source }`。`asOfSec = null` 表示"没测过"，前端画 `—` 加来源词，不画 `0`；`asOfSec` 不允许是 0（那会读成 1970 年测的）。 |

状态词表（判定码 → 词 → 色调）只有一份：`healthWordForVerdict`、`customerHealthWord`、`toneFor`。
阈值属于判定引擎（`verdict.ts`），不进合同；合同只管词汇。

## 纯度

`src/ops/contract.ts`、`src/ops/contract/*.ts`、`src/ops/http.ts` 只能 import `src/errors.ts` 和同目录的兄弟文件。
不许 Env、不许 D1 类型、不许其他模块——控制台直接编译这些文件，一个 `import type { Env }` 就会把 Worker 运行时拖进浏览器构建。
`tooling/scripts/check-ops-contract-purity.mjs`（`npm run check:contract`）在 CI 里守这条线。

## 端点与返回的 DTO

| 端点 | 返回 |
|---|---|
| `GET nodes?cursor&limit&verdict&listed&since` | `ListDto<NodeSummaryDto>` |
| `GET nodes/{name}` | `NodeDetailDto` |
| `GET nodes/{name}/history` | `ListDto<NodeHistoryEntryDto>` |
| `GET nodes/{name}/connections` | `ListDto<ConnectionEventDto>` |
| `GET nodes/{name}/errors?range` | `Measured<NodeErrorRowDto[]>` |
| `GET nodes/{name}/bindings` | `NodeBindingsDto` |
| `GET nodes/{name}/jobs`、`POST nodes/{name}/jobs` | `ListDto<JobDto>` / `JobDto` |
| `PATCH nodes/{name}/profile` | `NodeDetailDto` |
| `GET customers?cursor&limit&focus&q&since` | `ListDto<CustomerSummaryDto>`（`wechatId`。`q` 按 email 或 wechat_id 子串过滤，大小写不敏感；缺省/空 `q` 行为与原来相同） |
| `GET customers/{id}` | `CustomerDetailDto`（`wechatId`、`contact`、`notes` 来自 `users`；`devices[]` 带每台设备的 live 字段：`connected`、`selectedServer`、`lastSeenAt`、`lastFailAt/Code/Node`，来自 `ops_device_status`） |
| `POST users/onboard` | 已注册写 `users.wechat_id/contact/notes`，`pendingProfile: false`；未注册把这三项写在 `signup_allowlist` 上，`pendingProfile: true`，首次注册带到 `users`。其余 legacy 响应字段不变 |
| `GET customers/{id}/connections?deviceId=` | `ListDto<ConnectionEventDto>`（`deviceId` 可选，按设备过滤） |
| `GET customers/{id}/activity?range` | `ListDto<ActivityHourDto>` |
| `GET customers/{id}/destinations?range` | `ListDto<DestinationRowDto>` |
| `GET customers/{id}/services?range` | `ListDto<ServiceUsageDto>` |
| `GET incidents?status&severity&subjectType&since` | `ListDto<IncidentDto>`（`status=resolved` 含误报关闭；控制台再滤） |
| `GET incidents/{id}` | `IncidentDetailDto` (`{ incident, events, jobs, deliveries }`) |
| `POST incidents/{id}/ack\|snooze\|resolve\|notes` | `IncidentDto`。`snooze` 接受 `until`（epoch 秒）、`durationSec`，或控制台用的 `seconds`（1..7 天）。`resolve` 必带 `closure`：`verified` / `false_positive` / `manual`，另可 `note`；`false_positive` 写事件 `note`「误报：…」，不计入恢复 |
| `PATCH incidents/{id}` | `IncidentDto`。只接受 `{ nextCheckAt }`（epoch 秒），其它键 400；写 `next_check_at` 与事件 `note`「下次检查 \<time\>」 |
| `GET customers/{id}/followups` | `ListDto<FollowupDto>`，最新在前 |
| `POST customers/{id}/followups`、`POST incidents/{id}/followups` | 201 `FollowupDto`。body `{ kind, body, dueAt? }`，`kind` ∈ `reply\|await_customer\|callback\|verified\|note`，`body` ≤2000 |
| `PATCH followups/{id}` | `FollowupDto`。`{ done?, body?, dueAt? }` |
| `GET followups?due=today\|overdue\|open` | `ListDto<FollowupDto>`，所有主体，到期最早在前，最多 200；缺省 `due=open` |
| `GET digest?day=YYYY-MM-DD` | `DigestDto`。缺省今天，按 Asia/Shanghai 日界。`overnight.resolved` 不含 `false_positive` |
| `GET jobs?status&executor`、`POST jobs/{id}/cancel` | `ListDto<JobDto>` / `JobDto` |
| `GET releases?platform&channel`、`POST releases`、`PATCH releases/{id}` | `ListDto<ReleaseDto>` / `ReleaseDto` |
| `GET releases/adoption?range` | `AdoptionMatrixDto` |
| `GET direct-candidates?status` | `ListDto<DirectCandidateDto>` |
| `POST direct-candidates/{etld1}/accept\|reject` | `DirectCandidateDto` |
| `POST traffic-policy/draft-from-candidates` | 沿用现有 traffic policy 草案响应（仍需签名与确认） |
| `provider-accounts`（CRUD） | `ListDto<ProviderAccountDto>` / `ProviderAccountDto` |
| `home-lines`（CRUD） | `ListDto<HomeLineDto>` / `HomeLineDto` |
| `GET home-lines/{id}/usage?range` | `ListDto<HomeLineUsageDayDto>` |
| `alert-rules`（CRUD）、`POST alert-rules/{id}/test` | `ListDto<AlertRuleDto>` / `AlertRuleDto` |
| `GET alert-deliveries` | `ListDto<AlertDeliveryDto>` |
| `GET audit?before&beforeId&limit&targetId&actorEmail` | `AuditListDto` (`{ entries, hasMore, nextBefore, nextBeforeId }`) |
| `GET system/health` | `SystemHealthDto`（`backfill` 为 `BackfillHealthDto`，flatten/project 游标都追上后为 `null`） |
| `GET ledger?month=` | `ListDto<LedgerEntryDto>`，最新在前。`month` 为 `YYYY-MM`，缺省当月 |
| `POST ledger` | 201 `LedgerEntryDto`。body `{ kind, category, subjectType, subjectId?, amountMinor, currency?, month, paidAt?, note?, fxDate? }`。`currency` 可省略：`revenue`/`refund`/`credit` 缺省 `CNY`，`cost` 缺省 `USD`。收款三类必须是 `CNY`，否则 400 `VALIDATION_ERROR`「收款只收人民币」。`cnyMinor` 按 `fxDate`（缺省当天）已存汇率换算；非 CNY 且无汇率时 409 `FX_RATE_MISSING`。目标月已锁定则 409 `MONTH_CLOSED` |
| `PATCH ledger/{id}` | `LedgerEntryDto`。只接受 `{ note?, paidAt?, subjectType?, subjectId? }`，不能改 `currency`；月已锁定 409 `MONTH_CLOSED` |
| `POST ledger/{id}/reverse` | 201 `LedgerEntryDto`。在当前月写入一笔相反效果（`cnyMinor` 取反），`reverses` / 原行 `reversedBy` 互指。锁定月也允许——这就是冲正的意义 |
| `GET months/{month}` | `MonthSummaryDto`。收入 = Σ(revenue+credit)−Σ(refund)；成本 = Σ cost；客户成本 = 名下 Claude/ChatGPT 账号成本 + 该月该节点/线路字节占比摊到的 server/home_line 成本。用量缺测或有字节无成本时 `pending: true` 且客户 `marginCnyMinor` 为 null |
| `POST months/{month}/close` | `MonthSummaryDto`。body `{ notes? }`。已锁定 409 `MONTH_CLOSED`，写入当时的汇总数字 |
| `GET months/{month}/export.csv` | `text/csv; charset=utf-8`，UTF-8 BOM，一行一笔 + 合计行。不是 JSON，不进 GET 检查器表 |
| `GET fx?day=&base=` | `FxRateDto`。返回该日或更早最近一条（自带 `day`）。`base=CNY` 时汇率 1、不查表。没有更早记录 409 `FX_RATE_MISSING` |

`PATCH nodes/{name}/profile` 字段全可选（未知键 400）：`provider` ≤80、`providerAccountId`（须存在于 `provider_accounts` 或 null）、`region` ≤80、`lineTags` 最多 8×32、`port` 1..65535、`price` ≥0、`currency` 三字母、`billingCycle` 1..3660 天、`renewsAt`/`expiresAt` unix 秒、`notes` ≤2000、`quota` 为 `{ quotaBytes, cycleKind, cycleAnchorDay, counts }` 或 `null`（null 清周期）。无 profile 行时，节点只要在 catalog/status 里就会补一行。写 `ops_audit` `node.profile.update`。

公开（无 Access、无登录）`GET /api/v1/system/pulse` 返回 `{ ok, cronAgeSec, buildSha }`：`ok` 表示 cron 在 15 分钟内跑过；`cache-control: no-store`；按 IP 每小时 60 次。不含源名或其它内部细节。

采集侧（`/api/v1/ops-ingest/*`）与客户端侧（`/api/v1/telemetry/failures`）不归这份合同管，它们有各自的入站校验。`POST /api/v1/telemetry/failures` 与周期窗口事件（`telemetryEventStringKeys`）接受可选 `attemptId`（≤64 字），写入 `connection_events.attempt_id`；失败即报与随后窗口里的同一次尝试 `(user_id, attempt_id)` 只留一行（两边都是 `INSERT OR IGNORE`）。客户投影先写 `ops_device_status`，再按规则合成 `ops_customer_status`：`connected`＝任一台有新鲜心跳的已连接设备，`selected_server`＝最近见到的已连接设备的节点，`last_seen_at`＝max，`app_version`＝近 30 天各设备的最低版本，`last_fail_*`＝各设备最近一次，`fails_30m`＝求和。
现有 `/ops/dashboard|fleet-nodes|activity|live|users|metrics|usage-hours` 在切换前保持不动。

账目写入都记 `ops_audit`（`ledger.create` / `ledger.update` / `ledger.reverse` / `month.close`）。汇率由 cron 的 `fx` 步每天向 `https://api.frankfurter.app/latest?from=<BASE>&to=CNY` 拉 USD/EUR/GBP/JPY/HKD；失败则该步 `ok: false`，已存汇率不动。告警 webhook 主机白名单不管这条：那是防 SSRF 的，这条是 Worker 自己对写死主机的空 GET，不带客户或账本数据。

`GET audit` 由 shared-admin 先于 v1 dispatch 承接，信封是 `{ entries, hasMore, nextBefore, nextBeforeId }`，条目上 `actorType` / `actorRole` / `requestId` 可空。词表与库一致：`actor_type` 为 `access_admin|token_admin|collector|exit_node|system`，`actor_role` 为 `owner`；配额 `counts` 为 `in|out|in_out`、`level` 为 `ok|chore|warn|severe`（无配额时 `level: ok` 且 `quota: null`）；路由 `cloud|residential|direct|reject|unknown`；连接来源 `window|direct|diagnostics|failure`；告警 `fireOn` 为 `open|open_resolve`，投递 `transition` 另加 `test`；事故事件 `type` 为 `opened|escalated|deescalated|acked|snoozed|note|job|alert|resolved`；事故 `closure` 为 `verified|false_positive|manual`（可空）；跟进 `kind` 为 `reply|await_customer|callback|verified|note`，主体 `user|incident|node`；版本档 `current|behind_one|behind_more|unreported`。

## 加端点的规矩

1. 先在 `src/ops/contract/` 里加 DTO 和 `assert*` 检查器（键白名单 + 类型守卫，不引 schema 库），并在 `test/ops-contract.test.ts` 加一条夹具与三种漂移用例（少键、多键、类型错）。
2. 处理器返回前跑检查器；列表用 `listEnvelope()`，游标用 `encodeCursor()`，响应用 `jsonWithEtag()` 并在查询前调 `notModified()`。
3. 上表加一行。**未来的路由表覆盖测试**会对没有检查器、或没出现在这张表里的端点报错——所以这两步不是文档工作，是让 CI 通过的条件。
4. 字段只增不改语义；确实要改语义或删字段，`CONTRACT_VERSION` 加一。
