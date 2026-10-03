## 2026-10-03 · 控制面：失败聚类告警和诊断会话里放不放客户端原文

- Status: provisional
- Chosen: 不放。离开控制面的告警（webhook body）和它读的样本（`failure_clusters.sample_json`）里，客户端提供的每个字段都按类别取形：`code`/`stage` 是标识符（字母开头，仅字母数字下划线），`appVersion` 是 `x.y.z`，`appBuild` 是数字，`gitCommit` 是十六进制，`coreVersion` 是 `[v]x.y.z[-tag]`，`platform`/`channel` 是枚举；不符合的输出占位符 `[unclassified]`。`node` 只有在服务端发过这个名字（`exit_nodes.name` 或 `operations_logical_nodes.display_name`，` · hy2` 后缀按同一节点算）时才外发，否则 `[unlisted]`。样本不再带错误文本。诊断包的 `session.outcome`、`session.reason` 只接受标识符，其余 400。入库侧保持宽松（老客户端继续能上报），只收紧外发副本。被拒的选项：继续扩正则脱敏（主机名、IPv6、任意凭据写法无法穷举，`logExcerpt` 已因同一理由停止自动保存）；在入库处直接 400（会让 0.0.32–0.0.44 这类老客户端的失败上报整条丢失）；只用字符集校验 `node`（目录显示名带空格和 `·`，字符集分不清它和散文）。
- Why stricter: 告警 webhook 的接收方是第三方（Telegram/飞书/自建 bot），外发内容必须是可枚举的分类字段。排障不受影响：每条失败上报仍在自己的 `connection_events.error` 行里保存脱敏后的错误文本（决策 051），聚类详情接口按聚类成员能查到；只是不再复制进样本、不再出控制面。代价：生产上节点名对不上服务端表的聚类，告警里节点显示 `[unlisted]`（2026-10-03 只读统计：近 14 天 12 个节点名里 `exit_nodes` 对上 6 个），要点 `detailPath` 看原名。没有任何已发布客户端发送 `session`（Windows 只发 `events`，macOS 转发已存盘的失败/事件包），收紧不影响现网。
- Applied in: 本 PR（发现 CP-DIAG-RAW-TEXT）。
