## 2026-10-03 · 控制面：失败聚类告警和诊断会话里放不放客户端原文

- Status: provisional
- Chosen: 不放。离开控制面的两个出口（告警 webhook、读接口返回的聚类样本）里，客户端提供的值只有三种出法：标识符（`code`/`stage`，字母开头、仅字母数字下划线）、枚举（`platform`、`channel`）、服务端自己发过的值——`node` 要在 `exit_nodes.name` 或 `operations_logical_nodes.display_name` 里（` · hy2` 后缀按同一节点算），`appVersion` 要在发布登记表 `client_releases.version` 里；对不上的输出占位符 `[unlisted]` / `[unclassified]`。聚类样本只留 `channel`，不带错误文本，也不带构建标识（appBuild、gitCommit、coreVersion）。诊断包的 `session.outcome`、`session.reason` 只接受标识符，其余 400。入库侧保持宽松（老客户端继续能上报），只收紧外发副本。被拒的选项：继续扩正则脱敏（主机名、IPv6、任意凭据写法无法穷举，`logExcerpt` 已因同一理由停止自动保存）；按形状校验版本和构建号（复审反例：`192.168.257`、`3232235777` 对 URL 解析器是 IPv4，`v1.2.3-intranet` 是主机名——形状不是出处）；在入库处直接 400（会让 0.0.32–0.0.44 这类老客户端的失败上报整条丢失）。
- Why stricter: 告警 webhook 的接收方是第三方（Telegram/飞书/自建 bot），外发内容必须是可枚举的分类字段。排障不受影响：每条失败上报仍在自己的 `connection_events.error` 行里保存脱敏后的错误文本（决策 051），聚类详情接口按聚类成员能查到；只是不再复制进样本、不再出控制面。代价：2026-10-03 生产上 `client_releases` 是空表、近 14 天 12 个节点名里 `exit_nodes` 只对上 6 个，所以部署后告警里的版本一律显示 `[unlisted]`、约一半节点显示 `[unlisted]`，要点 `detailPath`（读令牌鉴权）看原值；发布登记表有了行（G4 发布流程会写）版本就会显示。构建标识仍在每条 `connection_events` 行上。
- Applied in: #1368（`8a2267c2`，发现 CP-DIAG-RAW-TEXT）。
