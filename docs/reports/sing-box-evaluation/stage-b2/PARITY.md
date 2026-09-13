# B2 只验证合成 AI 请求的路由/认证/负载等价

**57/57 smoke 通过**，然后才执行三轮测量。二进制和工具源文件哈希必须与 smoke
相同，否则 runner 拒绝测量。[完整检查数据](raw/smoke.json)。

- HTTPS 强制 TLS 1.3 + HTTP/1.1，验证自有 CA 和 hostname，没有 session cache。
  每次是实际 POST，服务端检查 prompt 内容/长度并回传长度，客户端检查完整 JSON。
  错 CA、错 SNI、HTTP 503、超时不能计为成功。
- SSE 必须逐个收到有序、完整空行分隔的事件，所有回复字节正确，并收到 `[DONE]`。
  缺 DONE 即使已收到全部 text 也失败。不是仅收到 HTTP headers 就算流式回复成功。
- 冷请求强制新应用 TCP/TLS；复用由真实服务端 connection ID 和客户端连接对象共同验证。
  HTTP/1.1 worker 显式 Write/ReadResponse，没有库的自动 retry/POST replay。
- DNS 经 UDP/TCP TUN 返回 fake-IP，再用该地址完成 HTTPS。性能批次使用相同 literal IP，
  **不包含 DNS 解析耗时**。
- 通过服务端口选择 Reality/Hy2，不进行智能选择/隐式 fallback。同一客户端同时存在两条
  活跃链由 `/connections` 和两份完整 SSE 回复证明；这只是 smoke，不是混合大流量排名。
- 实际 Hy2 外层错 CA/SNI、Reality 错 short ID 失败，而未受影响的另一协议成功。
  崩溃后无直达 origin 路由；这来自封闭 namespace，不冒充 PF/WFP。

## 两个与旧 B 结果不能混算的变化

1. HTTP origin 从 Python 改为 Go TLS 1.3 HTTPS，增加 prompt/body 验证及 SSE 生成节奏。
   HTTP 层仍为 1.1；没有 HTTP/2/HTTP/3、多模态、工具调用、浏览器或真实 provider SDK。
2. Hy2 带宽字段从旧 B 的 100 Mbps 改为两端省略。两者均选择 BBR 路径而不是固定带宽
   Brutal；这不是相同 BBR 实现。A 的路径是
   `adapter/outbound/hysteria2.go:211–232` → `transport/tuic/common/congestion_v2.NewBbrSender`；
   B/C 使用其固定 sing-quic 依赖实现。不由吞吐数据猜拥塞算法。

## 产品迁移差异仍未关闭

[B 的实际 reload/DNS/路由证据与源码](../stage-b/PARITY.md)继续适用；本批次不重跑旧 gate：

- sing-box `PUT /configs` 的 HTTP 204 不应用配置；实际 SIGHUP 会重建 TUN。
  没有证明 SSE 能无损跨 reload，也没有把 204 当成功配置提交。
- 显式 DNS endpoint 在 fake-IP 池之外；TTL、cache 和生产 pin 语义仍不完全等价。
- 规则优先级、默认拒绝的 B 证据来自同样的路由配置生成器；本次只删除 Hy2 bandwidth
  字段，未据“能启动”新增全规则等价结论。
- Endpoint allowlist、策略 digest、DIRECT lease、helper/service 所有权、controller events、
  native DNS 恢复和 updater 交接仍需独立适配/原生验证。

结论仍是 **PARITY_GAP**：合成负载可比较，不等于内核可直接替换。
