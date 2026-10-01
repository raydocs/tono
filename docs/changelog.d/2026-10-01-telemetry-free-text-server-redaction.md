## 2026-10-01 · 服务器端遥测自由文本脱敏

- 归属：ops / 隐私；影响 control-plane `/api/v1/telemetry/windows`（`telemetry-window.ts`）。
- 来源：main `0676435b`；分支 `claude/fix-1201-telemetry-free-text-scrub`；关联 #1201。未合 main。
- 缺陷修复：周期窗口事件的 `error`、`reason`、`probe`、`from`、`to` 原样入库并拷进 `connection_events`，客户端只去凭据，`dial <出口IP>:443` 之类保留出口地址、UUID、邮箱。改为：校验后、入库和展平前，用已有的 `redactJobResult`（与连接失败上报同一套：密码赋值、UUID、邮箱、IPv4）脱敏，结果仍截到 500 字符。节点名等其他字段不变；采集内容和开关默认值不变。
- 新增/优化：无。
- 工程与测试：`ops-ingest-hooks.test.ts` 新增一条：带 IP/UUID/邮箱的 connectFail 事件入库后 `payload_json` 与 `connection_events` 都不含这些值。
- 验证：本机 `npx vitest run test/ops-ingest-hooks.test.ts`：修复前新用例失败（`payload_json` 含 `203.0.113.7`），修复后 18/18 通过。全量 `npx vitest run`：994 个测试通过；`parser-properties.test.ts` 因本机 node_modules 缺 `fast-check` 无法加载（环境问题，与本改动无关），CI 跑。
- 候选/发布：仅源码，无新候选；需部署 control-plane 才生效。
- 剩余限制：服务器脱敏不含 IPv6 和家目录路径；客户端仍会把原文发到服务器（Windows 客户端另开 PR，macOS 无现成脱敏器，未改）。脱敏把短 IPv4 换成 `[redacted]` 可能略增长度，接近 64 KiB 上限的窗口可能变成 413。
