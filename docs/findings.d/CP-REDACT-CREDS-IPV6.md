| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-REDACT-CREDS-IPV6 | 控制面最后一道脱敏 `redactJobResult`（遥测事件自由文本、连接失败 ingest、采集任务结果都经它进 D1 与运维台）只去 UUID、邮箱、IPv4、password，不去 `Authorization`/`Cookie` 值、`Bearer` 令牌、`token=`/`accessToken`/`refreshToken` 赋值、URL userinfo 和 IPv6 地址；客户端漏掉的会话凭据或家庭 IPv6 前缀会原样落库 | in-PR | 本 PR | 中·已确认 | 只管新写入的行，库里已有的行不回扫；IPv6 只认八组全写或带 `::` 的压缩写法，冒号分隔的六组 MAC 不处理；`token: <词>` 形状的普通报错（如 `invalid token: expired`）里那个词会被一起抹掉（与 Windows 客户端 `audit.rs` 相同取舍） |

审计发现（2026-10-27，安全与隐私轮）。回归 `redacts bearer tokens, token assignments, URL userinfo and IPv6 addresses but keeps clock times`（`services/control-plane/test/ops-jobs.test.ts`）在旧代码上失败：输出原样保留 `Bearer eyJhbGciOi…`、`"refreshToken":"rt-SECRET-1"`、`accessToken=at-SECRET-2`、`Cookie: sid=…`、`[2001:db8:85a3::8a2e:370:7334]`、`fe80::…%en0`；旧邮箱规则还把 `vless://alice:pw@exit.example` 里的密码连同主机一起吃掉，诊断里看不到失败的主机。
