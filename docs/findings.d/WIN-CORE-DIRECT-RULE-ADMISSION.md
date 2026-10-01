| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-CORE-DIRECT-RULE-ADMISSION | Windows Service 准入 mihomo 与 sing-box 文档时只校验最终规则，不限定哪些规则可以送往 DIRECT 出站；DIRECT 计划期间 WFP 对核心的直连许可不按目的地限定 | open | [#1204](https://github.com/raydocs/tono/issues/1204) | 高·推导 | main 既有问题，两种核心都有，#1188 未引入也未修；需与进行中的按进程直连（#1175）对齐准入形状；DIRECT 计划之外 WFP 仍拦截 |
