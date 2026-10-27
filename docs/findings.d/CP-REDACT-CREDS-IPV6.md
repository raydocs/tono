| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-REDACT-CREDS-IPV6 | 控制面最后一道脱敏 `redactJobResult`（遥测事件自由文本、连接失败 ingest、采集任务结果都经它进 D1 与运维台）只去 UUID、邮箱、IPv4、password，不去 `Authorization`/`Cookie` 值、`Bearer` 令牌、`token=`/`accessToken`/`refreshToken` 赋值、`api-key`/`secret` 赋值、URL userinfo 和 IPv6 地址；结构化任务结果（`redactJobJson`）里除 `password` 外，`refreshToken`/`accessToken`/`token`/`cookie`/`apiKey`/`secret` 等键的值也原样保留；客户端漏掉的会话凭据或家庭 IPv6 前缀会原样落库 | in-PR | 本 PR | 中·已确认 | 只管新写入的行，库里已有的行不回扫，靠现有保留期自然清除（`telemetry_windows`、`connection_events` 30 天；`ops_node_jobs`、`failure_clusters` 90 天；`telemetry_windows` 有禁止 UPDATE 的触发器），部署满 90 天后旧行全部过期；IPv6 只认八组全写、带 `::` 的压缩写法、至少两组的 `前缀::` 与 `::x:y` 形式（`::1` 保留），冒号分隔的六组 MAC 不处理；`token: <词>` 形状的普通报错（如 `invalid token: expired`）里那个词会被一起抹掉（与 Windows 客户端 `audit.rs` 相同取舍） |

审计发现（2026-10-27，安全与隐私轮）。回归 `redacts bearer tokens, token assignments, URL userinfo and IPv6 addresses but keeps clock times`（`services/control-plane/test/ops-jobs.test.ts`）在旧代码上失败：输出原样保留 `Bearer eyJhbGciOi…`、`"refreshToken":"rt-SECRET-1"`、`accessToken=at-SECRET-2`、`Cookie: sid=…`、`[2001:db8:85a3::8a2e:370:7334]`、`fe80::…%en0`；旧邮箱规则还把 `vless://alice:pw@exit.example` 里的密码连同主机一起吃掉，诊断里看不到失败的主机。

2026-10-27 续修（同一 PR）：首轮回归之外又确认两类遗漏，在首轮代码上复现：`redactJobJson({refreshToken:'rt', auth:{access_token, 'X-Api-Key', cookie}})` 原样返回四个值；`2001:db8:4f2a::`、`::ffff:c000:280`、`{'accessToken': 'at'}`、`x-api-key: k` 原样返回。修复后两条回归（`redacts credential values stored under structured result keys` 与扩充后的 `bearer tokens` 用例）在首轮代码上失败、在新代码上通过。

历史 D1 行：本轮不改生产数据。四张表都有到期删除，部署后最多 90 天自然清空；若要提前清除，须作为单独任务：先导出 D1，在 preview 上用同一 `redactJobResult`/`redactJobJson` 脚本演练，只对 `ops_node_jobs.result_summary/result_json` 与 `failure_clusters.sample_json` 做按批 UPDATE；`telemetry_windows` 因不可变触发器只能等过期或删除，不应为此去掉触发器。
