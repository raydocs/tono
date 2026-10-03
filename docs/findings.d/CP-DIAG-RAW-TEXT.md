| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-DIAG-RAW-TEXT | 失败聚类样本保存客户端错误原文（主机名、IPv6 解析器不被正则脱敏）并随告警 webhook 外发；`session.reason` 接受 80 字符散文（含密码、对端地址） | in-PR | 本 PR | 高·已确认 | 失败上报自己的 `connection_events.error` 行仍存脱敏后的错误原文（决策 051：故障报告含错误文本），只有控制面读权限可见，不外发 |

来源：部署前 Codex 范围评审（`57c1c64c..66a5bc5c`，`services/control-plane/src` + `migrations`，2026-10-03）。复现：`lookup private.example.com on [2001:db8::53]:53 failed` 原样进入 `failure_clusters.sample_json` 和 webhook body；`SOCKS5 password=s3cret peer=203.0.113.9` 作为 `session.reason` 返回 202 并入库。两项都未部署到生产（生产 Worker 仍是 `57c1c64c`，无 0093）。修法见决策 053：样本只留构建标识，`session.outcome`/`session.reason` 只收分类值。

复审（Codex r2，`0b73ffd3`）：只删 `error` 不够，`code`/`stage`/`appVersion`/`node` 和构建字段同样只校验长度，`appBuild: "password=s3cret private.example.com"` 仍会外发；`session.reason` 的字符集仍接受主机名。续修：外发边界按类别取形，不符合输出占位符；`node` 只外发服务端发过的名字；会话 token 改为标识符。

复审（Codex r3，`ebd195bc`）：形状不是出处——`192.168.257`、`3232235777` 通过版本/构建号正则，却是 IPv4 的简写和整数写法，`v1.2.3-intranet` 是主机名；读接口 `clusterDto` 原样返回旧样本。续修：版本只在 `client_releases` 登记过才外发；样本只留 `channel`；读接口走同一个 `outboundSample`。
