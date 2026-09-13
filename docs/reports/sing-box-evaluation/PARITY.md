# 迁移合同检查：Stage A，不是替换批准

**至少存在一个直接的 controller 合同不等价：sing-box 的 Clash API `PUT /configs` 在下述文档快照中只是 204 no-op。**
Tono 不能仅换二进制、保留 Mihomo reload 调用后宣称策略已生效。这是迁移 `PARITY_GAP`，不是当前 Tono Bug。

## 证据版本

- Mihomo：固定产品 upstream [`ac017cdd`](https://github.com/MetaCubeX/mihomo/tree/ac017cdd246ce8bd547653d927e7bf77d7ee73d5)。Tono patch 仅改变缓冲选项；构建见 BASELINE。
- SagerNet：仅为静态文档/API 审计保存 [`93fff595`](https://github.com/SagerNet/sing-box/tree/93fff5954390367dd456cad3cbd79be54f8b941f) 的8个源码/文档文件；API 返回日期 2026-09-13T13:44:14Z。
  **这不是阶段 B 候选选择**，没有 checkout/build/run sing-box。默认分支查询为 `testing`。先前外部检索给出的 `dev-next` 引用无法解析（HTTP422），本报告不用这些浮动链接当证据。
- 此静态快照的 `go.mod` 指向 `github.com/sagernet/sing-tun v0.9.4-0.20260912075549-869f0a4d76af` 与 SagerNet gVisor；不能与 MetaCubeX `sing-tun v0.4.22` 做版本号大小比较。
- 获准阶段 B 后必须重新确定一个能同时产出 B/C 的固定 commit、build tags 和真实 stack 合同。这里不从文章猜配置字段，也不把已弃用/变化中的 stack 名当可运行结论。

## 合同与验收缺口

| 合同 | 已有 Tono/Mihomo | sing-box 所需证明 / 状态 |
|---|---|---|
| 签名目录、节点身份 | Tono 验签/准入；Hy2 是同节点第二传输 | 保留相同准入层，不用 sing-box 配置替代签名目录。**NOT_TESTED** |
| Reality / Hy2 参数 | VLESS Reality flow、TLS fingerprint、public key/short ID；Hy2 TLS pin/SNI、密码和 UDP 端点 | 按固定候选核对认证、证书校验、pin、拥塞/带宽、mux 默认关闭。没有合法独立服务，**NOT_TESTED** |
| DNS/fake-IP | Tono 自己生成 DNS、fake-IP、bootstrap 和过滤规则，不信服务端 YAML | sing-box 1.12+ typed fakeip DNS server；验证 A/AAAA、IPv6关闭、TTL、反查、排除域、缓存持久化和恢复。**PARITY_GAP（未建立等价）** |
| DNS/路由规则次序 | 国内 DIRECT、拒绝规则、专用家宽与云出口有明确顺序 | 检查 match/action、解析回退、默认 outbound；DNS race 可能改变顺序。**NOT_TESTED**，禁止启动即认为等价 |
| controller 身份 | `/version`、随机 controller secret、Tono 特权所有者 | API兼容不证明实例身份；需要 PID/路径/hash/session/token 与端口共同绑定。**NOT_TESTED** |
| reload | Mihomo `PUT /configs` 真 parse/apply，Tono 在外层持有 fail-closed 事务 | 该 sing-box 快照 `updateConfigs` 只 `render.NoContent`。**CONFIRMED PARITY_GAP**；需要另外的特权重载/重启事务 |
| 选择器 / 旧连接 | Tono union→切选择器→真实探针→撤旧权限，显式关闭旧节点连接 | sing-box selector 有 `interrupt_exist_connections`，内部连接总中断；不能照搬旧连接关闭/恢复假设。**PARITY_GAP** |
| `/connections` / `/traffic` / totals | Tono 依赖连接元数据、累计bytes、规则/chain归属、ws更新 | 字段、单位、采样遗漏、reset/generation、内部DNS连接过滤需合同测试。**NOT_TESTED** |
| UI阶段/Connected | 两端已有真实系统TUN/保护DNS后才Connected；切换请求不是完成 | 核心/API ready不能作为Connected，保留Tono证据层。**NOT_TESTED** |
| endpoint allowlist | PF/WFP IP+port+protocol；DIRECT policy digest/lease | route exclusions ≠ 安全放行表；任何 auto_route/auto_redirect 不能越过特权owner。**PARITY_GAP（需适配）** |
| 生命周期/崩溃/取消 | privileged helper/service + generation fences + retained protection | 新进程启动/停止、TUN归属、DNS撤销、失败补偿与更新交接均需原生证明。**NOT_TESTED** |
| 家宽失败 | runtime group单成员，无静默云回退 | 固定出站图，失败明确传播；不能用fallback group“优化成功率”。**NOT_TESTED** |

## 精确 API / 源码证据

Mihomo固定源码：

- [go.mod](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/go.mod#L1-L44)：Go下限和MetaCubeX依赖。
- [controller debug挂载](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/hub/route/server.go#L78-L91)、[debug条件](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/hub/hub.go#L51-L68)：只有debug配置启用pprof。本次诊断与普通测量分开。
- [GET version](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/hub/route/server.go#L425-L427)：`meta`、`version`。
- [PUT configs](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/hub/route/configs.go#L359-L413)：parse payload/path，ApplyConfig。
- [ApplyConfig](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/hub/executor/executor.go#L70-L109)：暂停/交换/恢复，没有显式全量close tracked connections。但监听器/TUN重建仍可影响旧流，**本轮未测reload存活**。
- [PUT proxies](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/hub/route/proxies.go#L67-L100)：选择器写入在`/proxies/{name}`，不是`/group`。

SagerNet静态固定快照：

- [configs.go](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/experimental/clashapi/configs.go#L55-L74)：PATCH仅mode，PUT只返回204。
- [selector文档](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/docs/configuration/outbound/selector.md)：默认selector成员与`interrupt_exist_connections`语义。
- [fake-IP文档](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/docs/configuration/dns/server/fakeip.md)：1.12起的typed server和IPv4/IPv6范围。
- [DNS rule actions](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/docs/configuration/dns/rule_action.md#L38-L58)：普通顺序规则与1.14+ race规则不是同一调度合同。
- [Clash connections](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/experimental/clashapi/connections.go)：流量统计字段应逐一核对，不因Clash名字一致就视为相同。
- [TUN文档](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/docs/configuration/inbound/tun.md)：自动路由、排除路由、DNS和接口设置有平台差异。`auto_route`/`auto_redirect`不得当PF/WFP的替代。

## A阶段不回答的性能问题

没有 Reality TCP/TLS/认证或 Hy2 QUIC hook 数据，内部阶段全部 **不可观测/尚未测量**；没有用总耗时反推握手分段。
没有备用通道对照，没有评估1.2秒自动换节点阈值收益。应用并发、TCP/IP栈、QUIC stream与代理mux是不同变量。
不能从本地SOCKS成功推断 sing-box 更好、新Go栈更快、Hy2建连更快或迁移可以根治UI卡顿。
