## 2026-10-10 · 控制面记录客户端传输路径，cron 探测 API 中继
- 归属：运维计划 [§2](../ops/plan-2026-09-11.md)（中继可观测性；#1462 / #1463 的后续，所有者 2026-10-10「继续做 123456」）；
  `services/control-plane`（迁移、`client-identity.ts`、`api-relays.ts`、ops 读接口）与 `services/ops-console`（客户设备卡、节点页）。
- 来源：基线 48894dd90（main）→ 分支 `feat/cp-api-relay-observability-20261010`；PR 待开；未合 main。
- 缺陷修复：无。经中继的请求从出口节点 IP 到达，`edge_via_exit` / `edge_asn` 描述的是节点而不是客户，
  运维此前无从得知某台设备实际走哪条路径进来、中继本身是否还开着。
- 新增/优化：
  - 迁移 `0094_device_client_path.sql`（`devices.client_path` / `client_path_at`，只加列）。`recordClient`（登录、刷新、
    拉目录）读请求头 `X-Tono-Path`，只收 `pinned|system_dns|relay|doh|alt_port|tunnel`，格式合法但不在表内的值也丢弃
    （较严的选择）。路径变化或上次写入超过 3600 s 才写，五分钟一次的目录轮询平时不产生行写；写失败吞掉，不影响调用方响应。
    原有平台/版本写入语义不变。
  - 迁移 `0095_api_relay_probes.sql`（新表）。`src/api-relays.ts` 列出两个中继（Westwood 179.253.233.220:2053、
    Mesa 179.255.154.17:2053），注明须与 Windows `bootstrap.rs` `API_RELAYS`、macOS `ControlPlanePath.swift` `apiRelays` 同步。
    `enforceAll` 末尾加 `cronStep('api relay probe')`：两中继并行 `cloudflare:sockets` TCP 试连，各 5 s 超时，试连后关闭；
    失败记 `tcp connect: <原因>`（≤200 字）并维护 `ok_since` / `failing_since`；错误不抛出 `enforceAll`。
    Worker 不能指定 SNI，只证明端口开着，不证明 TLS 转发。
  - `GET /api/v1/ops/api-relays`（`nodes.read`）返回 `ApiRelaysDto`，有检查器、路由表行；`CustomerDeviceDto` 加
    `clientPath` / `clientPathAt`。控制台客户设备卡在版本旁显示「路径 relay · 3 分钟前」（旧版本不发头时不显示）；
    节点页加「API 中继」卡（可达/不可达、延迟、检查于 N 分钟前，失败原因悬停可见），fixture 模式读 `fixtures/api-relays.json`。
- 工程与测试：`index.ts` 行数棘轮——把 ops timeseries retention 的 try/catch 换成同名 `cronStep`（日志文字不变）抵消新增行；
  `StatusWord` 允许健康词表以外的词在自带 tone 时使用；fixture 生成器加两字段并重新生成 `customers*.json`，
  两份 captured `customers-id.json` 手工补字段。测试先于实现提交（红）：控制面 `test/api-relays.test.ts` 2 条、
  `test/ops-nodes.test.ts` 1 条；控制台 `Devices.test.tsx` 1 条、`nodes/ApiRelays.test.tsx` 1 条。
- 验证：见 PR 正文（本机 control-plane `npm test`、ops-console `vitest run` / typecheck / lint、`wrangler d1 migrations apply DB --local`）。
- 候选/发布：仅源码，无新候选；未部署。迁移为纯新增，生产前先在 preview 演练（运维计划 §2 item 1），由部署者经 `npm run deploy` 执行。
- 剩余限制：探测只到 TCP 层；客户端要等 Windows / macOS 发送 `X-Tono-Path` 的版本上线后才有数据；中继名单三处手工同步。
