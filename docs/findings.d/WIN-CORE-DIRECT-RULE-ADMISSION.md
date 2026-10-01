| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-CORE-DIRECT-RULE-ADMISSION | Windows Service 准入 mihomo 与 sing-box 文档时只校验最终规则，不限定哪些规则可以送往 DIRECT 出站；DIRECT 计划期间 WFP 对核心的直连许可不按目的地限定 | in-PR | [#1204](https://github.com/raydocs/tono/issues/1204) | 高·推导 | Service 准入现只放行编译器形状的 DIRECT 规则（两种核心）；WFP 的 DIRECT 许可仍不按目的地限定；按进程正则在全部 AI 固定规则之后按任意正则放行；sing-box 端口集不一致见 #1247 |
