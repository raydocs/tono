| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| HY2-IDLE-MIHOMO | 钉住的 mihomo v1.19.30 没有 HY2 保活字段，住宅 NAT 仍用核心内部 10 秒保活 | open | [#749](https://github.com/raydocs/tono/pull/749) | 低·推导 | sing-box 路径已写 5 秒；mihomo 要等核心升级才能短于 10 秒。不发明会被忽略的 YAML 键 |

对照 metacubex sing-quic `38b0e9295f51`：`DefaultKeepAlivePeriod` 10s，`DefaultMaxIdleTimeout` 30s，配置为 0 时由 `NewClient` 填上。`Hysteria2Option` 无 keepalive。正数 `handshake-timeout` 会把 QUIC 握手从调用方拆开，所以继续不写。
