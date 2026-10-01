| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-WEB-PINS-SUFFIX-STALE | macOS 策略包含任一显式网页后缀时停止刷新网页钉选，但生成运行时仍用旧钉选解析和拨号，CDN 退役旧地址后对应网站持续失败直到重连 | open | [#1016](https://github.com/raydocs/tono/pull/1016)（仅记录） | 中·推导 | P2；只影响相关网站，不声称全机断网。修复需区分仍负载拨号的钉选与可由后缀实时解析的主机，不能简单恢复会中全量重载；#958 的 DNS 发出器修改也在进行。未编译 Swift、未实机验证。 |

基线 `1fb29265`：`AppState+Connect.swift:1726–1729` 仅根据 `webDomainSuffixes.isEmpty` 调度刷新；`AppState+Catalog.swift:853` 用同一条件拒绝刷新。但产品发出器 `ConfigPipeline+SingBoxProduct.swift:185–190` 仍创建 `Tono-Hosts`，`:217–222` 在后缀直连之前为网页钉选执行 `resolve` 到 `Tono-Hosts` 并要求钉选 IP。

实际核心为 `93fff5954390367dd456cad3cbd79be54f8b941f`：[`route.actionResolve`](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/route/route.go#L897) 保存解析结果到 `DestinationAddresses`；[`ConnectionManager.NewConnection`](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/route/conn.go#L101) 使用这些结果拨号；[`DialSerialNetwork`](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/common/dialer/default_parallel_network.go#L16) 将这些地址转成数字 IP 后拨号。后面的 China DNS outbound resolver 不会自动替换已解析的拨号地址。旧地址失效是普通 CDN 更新，不要求第二个独立故障。Worker 支持同一策略包含网页钉选与其他后缀（`worker.test.ts:4591–4614`）；`retarget-direct-suffixes.rb:147` 也保留未覆盖的网页钉选。

不修的依据：`AppState+Connect.swift:1698–1722` 记录了会中全量重载切断所有连接的实际故障，因此重新打开周期重载会把局部网站失败换成整个会话的流式连接中断。需要设计并验证仅对仍必要的钉选更新，或移除已经被同端口后缀覆盖的静态解析依赖。不要把所有精确主机升为后缀，或自动回落出口来绕开这个取舍。#950 是刷新失败拆会话，#958 是客户端真实 DNS 丢失域名，两者与本项不同。
