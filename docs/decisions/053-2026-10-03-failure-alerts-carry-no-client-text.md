## 2026-10-03 · 控制面：失败聚类告警和诊断会话里放不放客户端原文

- Status: provisional
- Chosen: 不放。失败聚类样本（`failure_clusters.sample_json`，也是告警 webhook 的 `cluster.sample`）只留构建标识（appBuild、gitCommit、coreVersion、channel），不再带客户端错误文本；诊断包的 `session.outcome`、`session.reason` 只接受分类值（`[A-Za-z0-9_.:-]`，无空格），散文直接 400。被拒的选项：继续扩正则脱敏（主机名、IPv6、任意凭据写法无法穷举，`logExcerpt` 已因同一理由停止自动保存）；保留样本原文但不外发（样本和告警读同一列，两条路径容易再次分叉）。
- Why stricter: 告警 webhook 的接收方是第三方（Telegram/飞书/自建 bot），外发内容必须是可枚举的分类字段。排障不受影响：每条失败上报仍在自己的 `connection_events.error` 行里保存脱敏后的错误文本（决策 051），聚类详情接口按聚类成员能查到；只是不再复制进样本、不再出控制面。没有任何已发布客户端发送 `session`（Windows 只发 `events`，macOS 转发已存盘的失败/事件包），收紧不影响现网。
- Applied in: 本 PR（发现 CP-DIAG-RAW-TEXT）。
