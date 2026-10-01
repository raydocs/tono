## 2026-10-01 · Windows (mihomo) gVisor 窗口上限提到 2 MiB

- 归属：SHIP_PLAN G1（已连接=能用）；影响 Windows mihomo gVisor，不影响 macOS sing-box。
- 来源：main `718eda43`；分支 `cursor/win-gvisor-window-2mib-10e8`；未合 main。
- 缺陷修复：无。
- 新增/优化：活动流的发送和接收窗口上限从 128 KiB 提到 2 MiB。初始仍是 32 KiB，下限 4 KiB，接收缓冲调节保持打开。回环上按 150 ms RTT 的应用窗口测算，吞吐从 7.0 Mbps 到 110.1 Mbps（15.7 倍）。40 ms 时从 25.9 Mbps 到 397.7 Mbps。
- 工程与测试：补丁内 `TestTonoAdaptiveGVisorTCPBuffers` 的期望上限改为 2 MiB。身份文件与构建脚本模板一起改到 `gvisor-adaptive.2`。
- 验证：窗口数字来自本机 Linux 回环 ping-pong（固定字节再等一个 RTT，8 轮）。`go test` 与自适应核心构建未执行：本机 Go 1.22，脚本要求 go1.27.1。
- 候选/发布：仅源码补丁，无新核心二进制。已安装的 `gvisor-adaptive.1` 仍是 128 KiB，直到 windows-core 按这个补丁重编并发布。
- 剩余限制：needs-hardware。未在真机上对现网节点测吞吐。macOS sing-box 新栈已是接收 4 MiB、发送 2 MiB，本条不改它的 JSON。
