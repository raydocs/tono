# 0.0.86 · Build 87
> Apple Silicon、macOS 26.3+。本版新增签名策略 TCP 直连 IP 支持，之后新增或调整直连 IP 只需推送策略。

- 签名 TCP 直连 IP（#1856）：签名 `traffic-policy` 可携带 `tcpDirectAddresses`（无域名的 IPv4 TCP 目的地）与 v5 `tcpEndpoints`，这些地址直连并由 helper 的 fail-closed 过滤放行，无需重新发版
- Helper 协议版本随本版升级

## 时间线
客户端开始识别云端签名策略中的 TCP 直连 IP；生产策略 rev 11 已带 18 个国金 QMT IPv4。

## 限制
- 仅 Apple Silicon，需 macOS 26.3 或更高
- IPv6 全程关闭：TUN 与 fake-ip 只走 IPv4，AAAA 拨号由 Kill Switch 丢弃后客户端改试 IPv4
