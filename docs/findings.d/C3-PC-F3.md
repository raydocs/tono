| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| C3-PC-F3 | `PUT exit-catalog` 只逐条查字段，不做两端客户端都会做的集合级准入：节点重名、保留名（如 `DIRECT`、`REJECT`、`GLOBAL`）与 macOS 拒收的名称前缀；这样的目录两端整份拒收，发布却返回 200 | open | [#1415](https://github.com/raydocs/tono/pull/1415) 评审 `3af4d950` opus:F1 | 低·推导 | 未修（#1415 的一轮修复已用完）；测试夹具自身用了一个 Windows 保留名作「可准入」对照，修复时一并改 |
