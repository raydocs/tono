## 2026-09-30 · hy2 握手保持挂在调用方上

- 归属：SHIP_PLAN 客户连接路径（hy2 备用通道）。不是 G4 发布项，不发客户包。
- 来源：`main` `d2363002` → 本分支；未合 main。对照 mihomo v1.19.30 `adapter/outbound/hysteria2.go` 与 sing-quic `38b0e9295f51` `hysteria2/client.go`。
- 缺陷修复：无。不把 #664 的证书/超时当成客户端跳过校验。
- 新增/优化：运行时 hy2 块继续不写 `handshake-timeout`、不写 `skip-cert-verify`。正数 `handshake-timeout` 会让 sing-quic 把 QUIC 拨号从调用方 context 上拆开，取消连接后握手还在后台跑。钉住的核心已经在同一次 core 进程里用 `Early: true` 做 0-RTT，ALPN 空则默认 `h3`。重启 core 会丢掉会话，这里不为了 0-RTT 把 core 留在隧道拆掉之后。
- 工程与测试：原有 hy2 准入测试增加一条：生成的 YAML 不含 `handshake-timeout`。
- 验证：`cargo test -p tono-core --lib node` 未执行。本机 Cargo 1.83 解析不了 edition 2024（要求 1.98.1），未安装工具链。
- 候选/发布：仅源码，无新候选。
- 剩余限制：没有 Niagara/Erie 实机握手计时（#664）。0-RTT 只在同一次 core 进程内的后续流上生效，第一次连接仍然是完整握手。连接阶段预算见粘性自愈那条，不在这里重复测量。
