## 2026-10-08 · 控制面默认存储完整网络日志
- 归属：所有者 2026-10-08 直接决定（决策 [076](../decisions/076-2026-10-08-raw-network-logs-stored-by-default.md)，owner）；控制面 Worker（`services/control-plane`）；ops 诊断。
- 来源：基线 `origin/main` e99678129 → 分支 `claude/cp-diagnostics-logs-default-store-20261008`；PR 见本文件所在 PR；合 main 后需部署控制面才生效。
- 缺陷修复：`POST /api/v1/diagnostics/logs` 原先要求运营方为单台设备打开 `diagnostics_log_access` 窗口，否则回 `{stored:false, reason:"not_enabled"}` 不存。生产上这张表 0 行，客户端虽然默认开着上传，服务器从未存过一段完整日志，而 0.0.75 发布说明写的是「默认上传」。改后：已登录设备的上传直接存（R2 + `diagnostics_log_objects` 索引，并照旧进入流量解析）。14 天保留、单段 2 MiB gzip、每用户每小时 80 / 每天 800 段的限流、删号级联不变。
- 新增/优化：无。运营方开窗口的接口与 ops 页面仍在，只是不再决定是否存储（后续清理）。
- 工程与测试：`worker.test.ts` 用 `stores a raw log segment from a device no operator opened a window for` 替换 `acknowledges disabled raw logs…`，并从开窗口测试里删去「过期窗口不存」的断言。文档：[diagnostics-privacy.md](../diagnostics-privacy.md)、[ingest-limits.md](../ops/ingest-limits.md)。
- 验证：MacBook，`services/control-plane`：`npx tsc --noEmit` 通过；`npx vitest run test/worker.test.ts test/ingest-budgets.test.ts test/ops-ingest-hooks.test.ts test/ops-api.test.ts` 4 files / 283 tests passed；新测试在旧 `routes.ts` 上失败（`expected 200 to be 201`）。
- 候选/发布：无新包。客户端不变；已发布客户端收到 201 后会结束空探测、开始上传积压日志。
- 剩余限制：客户端注释仍写「服务器不开窗口就不存」（`log_upload.rs`、`DiagnosticsLogUploader.swift`），行为不受影响，未改。R2 用量随上传设备数增长，未设总量上限，只有每用户限流和 14 天保留。
