## 2026-10-01 · Windows (mihomo) 成功之后再等 1.5 秒才做 /delay

- 归属：SHIP_PLAN G1（已连接=能用）；影响 Windows 连接成功后的建议性时延采样。
- 来源：main `718eda43`；分支 `cursor/win-defer-advisory-delay-10e8`；未合 main。
- 缺陷修复：无。
- 新增/优化：数据面已经证明之后，建议性 `/delay` 等待 1500 ms 再发出。等待期间连接代际变了就不再探测。`unified-delay` 仍开。失败诊断和健康检查仍立刻探测。
- 工程与测试：`advisory_exit_probe_waits_until_the_first_page_can_start` 核对常量是 1500 ms。
- 验证：Linux 回环，mihomo，伪装 40 ms。单独首字节中位约 44 ms、1 次握手。与 `/delay` 并行时约 71.3 ms、2 次握手（`unified-delay` 开）。关掉 `unified-delay` 仍是约 71.7 ms、2 次握手，所以不是那个开关。`cargo test` 未执行：rustc 1.83 不能编译 edition 2024。
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware。健康周期里的探测仍可能和后来的流量重叠。1.5 秒是为了让第一页先走，不是测量出来的最优值。
