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
| `GET customers?cursor&limit&focus&since` | `ListDto<CustomerSummaryDto>` |
| `GET customers/{id}` | `CustomerDetailDto` |
| `GET customers/{id}/connections` | `ListDto<ConnectionEventDto>` |
| `GET customers/{id}/activity?range` | `ListDto<ActivityHourDto>` |
| `GET customers/{id}/destinations?range` | `ListDto<DestinationRowDto>` |
| `GET customers/{id}/services?range` | `ListDto<ServiceUsageDto>` |
| `GET incidents?status&severity&subjectType&since` | `ListDto<IncidentDto>` |
| `GET incidents/{id}` | `IncidentDto` + `ListDto<IncidentEventDto>` |
| `POST incidents/{id}/ack\|snooze\|resolve\|notes` | `IncidentDto` |
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
| `GET audit?cursor&targetId&actorEmail&actorType&action` | `ListDto<AuditEntryDto>` |
| `GET system/health` | `SystemHealthDto` |

采集侧（`/api/v1/ops-ingest/*`）与客户端侧（`/api/v1/telemetry/failures`）不归这份合同管，它们有各自的入站校验。
现有 `/ops/dashboard|fleet-nodes|activity|live|users|metrics|usage-hours` 在切换前保持不动。

## 加端点的规矩

1. 先在 `src/ops/contract/` 里加 DTO 和 `assert*` 检查器（键白名单 + 类型守卫，不引 schema 库），并在 `test/ops-contract.test.ts` 加一条夹具与三种漂移用例（少键、多键、类型错）。
2. 处理器返回前跑检查器；列表用 `listEnvelope()`，游标用 `encodeCursor()`，响应用 `jsonWithEtag()` 并在查询前调 `notModified()`。
3. 上表加一行。**未来的路由表覆盖测试**会对没有检查器、或没出现在这张表里的端点报错——所以这两步不是文档工作，是让 CI 通过的条件。
4. 字段只增不改语义；确实要改语义或删字段，`CONTRACT_VERSION` 加一。
