| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| issue-1260 | Windows sing-box 编译器按原样保留 DIRECT 主机名大小写，`qq.com` 与 `QQ.com` 生成两个 `predefined` 键，服务准入按 Go 折叠后拒绝，连接失败 | fixed(f676b6fb) | [#1260](https://github.com/raydocs/tono/issues/1260) | 中·推导 | 准入保持严格；编译器把主机名键统一为 ASCII 小写并合并地址。路由规则里的 `domain` 值保持原样。需实机验证 |

Codex 独立审查（gpt-6.1-sol high）发现，代码阅读确认。
