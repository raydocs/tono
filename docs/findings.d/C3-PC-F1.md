| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| C3-PC-F1 | Windows sing-box（现为默认内核）住宅路由只把助手 TCP 钉到住宅出口，没有助手 UDP REJECT；选中 HY2 出口时助手 QUIC 走 `final` 从云出口出去，暴露云出口身份 | in-PR | [#1272](https://github.com/raydocs/tono/pull/1272) | 高·推导 | 仅源码；sing-box 规则单测待托管 CI；QUIC 回退 TCP 需实机；needs-hardware |

WIN-HY2-HOME-UDP-LEAK（#783）只修了 mihomo，并注明「sing-box 同类缺口保留，Windows 产品路径尚未调用」。#1140/#1196 之后 sing-box 是 Windows 默认内核（`core_select.rs`），这一保留项已在产品路径上。macOS sing-box（`ConfigPipeline+SingBoxProduct.swift`）和 mihomo 两侧都已拒绝助手 UDP。修复：`sing_box/runtime.rs` 在有住宅目标时，按域名后缀、Anthropic CIDR、住宅进程名/路径各加一条 UDP reject。回归：`hy2_exit_with_a_home_hop_rejects_assistant_udp`。
