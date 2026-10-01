# 2026-10-01 · 相对 Clash 的速度

回环测量，伪装接受延迟 40 ms。Windows 现网内核是 mihomo gVisor。macOS 现网内核是 sing-box 1.15（省略 `stack`，新栈）。共享 sing-box JSON 编译器没有改。失败仍放行普通网络并拦住 AI；全阻断只在严格模式。没有为了速度改 AI 规则，也没有改成明文 DNS。

## 改了什么

| PR | 平台 / 内核 | 改动 | 改前 | 改后 |
| --- | --- | --- | --- | --- |
| [#1119](https://github.com/raydocs/tono/pull/1119) | Windows / mihomo | gVisor 窗口上限 128 KiB → 2 MiB，默认仍 32 KiB | 150 ms RTT：7.0 Mbps | 110.1 Mbps（约 15.7 倍） |
| [#1121](https://github.com/raydocs/tono/pull/1121) | Windows / mihomo | 备用 DoH 改懒查询，仍走出口 HTTPS | 87.5 ms，2 次握手 | 86.9 ms，1 次握手；主用挂了仍能答（129.5 ms，2 次） |
| [#1122](https://github.com/raydocs/tono/pull/1122) | Windows / mihomo | 数据面证明后等 1.5 秒再做 `/delay` | 并行 71.3 ms，2 次握手 | 单独路径约 44 ms，1 次握手 |
| [#1126](https://github.com/raydocs/tono/pull/1126) | macOS / sing-box | 同上，只推迟成功路径 | 并行 71.1–71.5 ms，2 次握手 | 单独路径 42.5–43.6 ms，1 次握手 |

四条都标了 needs-hardware，不自动合并。窗口那条在核心按 `gvisor-adaptive.2` 重编之前，已安装的二进制仍是 128 KiB。

## 量过、不是这次的差距

- Reality 握手：Tono 约 44 ms、1 次，Clash 约 43 ms、1 次。回环上已经同一档。HY2 / Trojan / VMess / SS 的旧表见 2026-09-30 的 connect-bench；Tono 不收 Trojan、VMess、SS。
- `find-process-mode` 的 always / strict / off：约 43–44 ms，没有可修的差。Windows 仍是 always。
- 关掉 `unified-delay`：并行仍是约 71.7 ms、2 次握手。多出来的是探测本身。
- macOS DNS 已经是主用 NOERROR 就停，否则才问备用。没有第二台竞速。
- macOS 新栈（sing-tun `97d11460`）接收上限 4 MiB、发送上限 2 MiB。没有 JSON 窗口字段。写成 `gvisor` 会选弃用路径，helper 也会拒绝。
- 明文 DNS 约 0.6 ms、0 次握手。不用。查询继续走出口。
- `tcp_fast_open` 未开。单独首字节已经在伪装延迟的地板上。把它放进 SYN 有机会让 Reality 失败。
- sing-box 对这份基准的 HTTP/1.1 DoH 打出两次串行握手（133.6 ms）。产品把 ALPN 钉成 `h2`，1.1.1.1 会说 h2，基准服务器不会。没有因此改 JSON。
