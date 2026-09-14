# B3 的等价范围是合成流负载，不是产品替换合同

三候选沿用 B/B2 固定的真实 TUN、MTU1500、自有 Reality/Hy2 服务及端点路由。
完整产品差异仍以 [B PARITY](../stage-b/PARITY.md) 和
[B2 PARITY](../stage-b2/PARITY.md) 为准；B3 不消除其中的 PARITY_GAP。

- 同一个自有 HTTPS fixture 同时支持 HTTP/1.1 和 HTTP/2；TLS1.3、测试 CA、正确 SNI。
  TLS session cache 未启用。不使用 `skip-cert-verify`，不接触真实 provider。
- 请求均为合成 POST，无应用重试；禁用 `GetBody`，服务端拒绝重复 request ID。
  SSE 先验证 warmup，再要求复用实际连接 ID。H2/c8 必须有一个连接和八个活跃 handler。
- 30s、600 events、128 bytes/event、50ms interval、4KiB prompt 为明确的合成参数。
  所有候选完全相同；不是 Claude/Grok/Gemini/OpenAI 的真实事件/压缩/分词数据。
- B/C 同一 sing-box 二进制，仅 stack 不同，适合分析栈相关差异。
  A 对 B/C 包含整个内核、依赖和 Tono patch 的差异，不能全归因于 TUN 栈。
- Hy2 带宽字段均省略，不人为设置 100Mbps 限速；双方拥塞控制实现不保证相同。
  B3 只将 Hy2 用于流正确性/取消，不据 CPU 数字或流速给它做性能排名。
- Normal 与 profile 配置区分：A 的 debug 日志和 B/C 的 debug listener 只用于诊断。
  配置哈希逐实例保留。CPU profile 不覆盖正常测量值。

**B3 未重新验证 reload、DNS/fake-IP、Tono 签名策略、端点收敛、PF/WFP 或更新交接。**
此前的真实 reload 与配置差异证据保留，不用新 HTTP 成功或 204 覆盖它们。
本次 HTTP 协议证据只证明应用链路协议；TCP dial、Reality 内部握手没有新增独立 hook，
不能从首事件、TTFB 或 CPU profile 推算精确握手分段。
