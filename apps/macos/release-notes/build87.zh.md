# Tono 0.0.86（build 87）

需要 Apple Silicon 与 macOS 26.3+。

## 相比 build 86 的更新

- **签名 TCP 直连 IP**（#1856）：签名 `traffic-policy` 现在可以携带 `tcpDirectAddresses`（无域名的 IPv4 TCP 目的地）与 v5 `tcpEndpoints`。这些地址直连，并由 helper 的 fail-closed 过滤放行，之后增删地址只需推送策略，无需重新发版。本版 helper 协议版本随之升级。
