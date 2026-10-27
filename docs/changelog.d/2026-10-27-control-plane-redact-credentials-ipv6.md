## 2026-10-27 · 控制面最后一道脱敏补上会话凭据与 IPv6
- 归属：运维计划（隐私 / 遥测数据最小化，非客户发布门）；控制面 `services/control-plane/src/ops/job-redaction.ts`，测试 `test/ops-jobs.test.ts`；发现 `docs/findings.d/CP-REDACT-CREDS-IPV6.md`。
- 来源：分支 `amp/server-redact-credentials-ipv6`（基线 origin/main `316d065`）；未合 main；控制面未部署。
- 缺陷修复：遥测事件自由文本（`error`/`reason`/`probe`/`from`/`to`）、连接失败 ingest 的报错、采集任务结果在入 D1 前只去 UUID、邮箱、IPv4 和 password。现在还去：`Authorization` 的方案和凭据、`Cookie` 值（到行尾）、`Bearer` 令牌、`token`/`accessToken`/`refreshToken`/`id_token` 赋值、URL userinfo（`://[redacted]@host`，主机保留），以及八组全写或带 `::` 的 IPv6。
- 新增/优化：无。保留：时钟时间（`12:30:45`）、Rust 路径（`tono_core::connection`）、`Authorization` 之后的报错原因、allowlist 的出口 IPv4。
- 验证：`npx vitest run test/ops-jobs.test.ts -t "bearer tokens"` 在旧代码上失败（输出原样保留 Bearer、refreshToken、accessToken、Cookie 与两种 IPv6），新代码通过；`npm test`（`services/control-plane`）结果见 PR 验证评论。
- 候选/发布：仅源码，无新候选；需部署控制面后生效。
- 剩余限制：库里已有的行不回扫；冒号分隔的 MAC 不处理；`token: <词>` 形状的普通报错里那个词会被一起抹掉。
