## 2026-10-10 · 控制面部署 main@11441941（API 中继探测、X-Tono-Path）
- 归属：所有者 2026-10-10「继续做 123456」（[decision 077](../decisions/077-2026-10-10-api-relay-outside-cloudflare.md)）；控制面。
- 来源：main `114419412`（#1466 合并提交）。相对上次部署 `639966e0e`，控制面代码多了 #1466（中继 TCP 探测 cron、`api_relay_probes`、`devices.client_path`、ops `GET /api/v1/ops/api-relays` 与控制台卡片）；#1462–#1465 只改桌面端、节点配置与文档。
- 缺陷修复：无（本次为 [2026-10-10-api-relay-followups.md](2026-10-10-api-relay-followups.md) 与 [2026-10-10-cp-api-relay-observability.md](2026-10-10-cp-api-relay-observability.md) 的上线记录）。
- 新增/优化：见上述两条。
- 工程与测试：#1466 评审 Grok-only `27eddcfb`（覆盖 `aa5ebd232`，PASSED，0 条）；评审后只多一个提交 `92a30192b`（`contract/customers.ts` 注释压缩，让 ops 合同文件回到 500 行预算内，无逻辑改动）；ci-gate `38025337211` 在 `92a30192b` 绿。本机 `npm run deploy` 第一次在 `npm test` 停下：`worker.test.ts` 的「rotates failed revocations」在全量 366 秒负载下超时 5 秒；隔离重跑通过，第二次全量 1008/1008 通过后才部署。CI 同一 SHA 45 个文件全绿。
- 验证：部署前 D1 导出 `2026-10-10T05:23:13Z.sql.gz`（SHA-256 `2f3667f7daebc74e90d2453fa408d276b9c3e6a47f3d590f8d322ddb5a1b2f30`），与 `.sha256` 一起上传 `tono-releases/backups/control-plane-d1/`。迁移 0094、0095 先在 `tono-control-plane-ops-preview` 演练通过，再由脚本应用到生产。API Worker 版本 `c975cada-6053-42a1-a5d7-9a27d532d14b`，admin Worker `ae0b2f24-c0ba-4089-82d4-3cad9091390f`；`/api/v1/system/version` buildSha `114419412…`，直连与经 Westwood 中继（`--resolve api.afk.ccwu.cc:2053:179.253.233.220`）都返回同一值。首轮 cron（05:35:43Z）后 `api_relay_probes` 两行：Westwood 与 Mesa 均 ok，149 ms，`ok_since` 1791610543；36 台设备 `client_path` 暂全空（要等带 `X-Tono-Path` 的客户端构建）。
- 候选/发布：无新包。
- 剩余限制：评审只有一个厂商；ops 控制台卡片只有 vitest 覆盖，没有在生产 Access 后台人工看过（会话没有 ops 管理 token）。
