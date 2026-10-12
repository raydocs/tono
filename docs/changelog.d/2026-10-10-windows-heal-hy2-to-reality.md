## 2026-10-10 · Windows 自愈：hy2 拨号失败先回同节点 Reality，不再因错误文本是超时就换节点
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)），中国大陆连通性审计（Windows）检查项 2；`apps/windows/crates/tono-core/src/heal.rs`。
- 来源：基线 origin/main 3d973f95；分支 `amp/win-heal-hy2-to-reality`，PR [#1536](https://github.com/raydocs/tono/pull/1536)；未合 main。
- 缺陷修复（[WIN-HEAL-HY2-SKIPS-OWN-REALITY](../findings.d/WIN-HEAL-HY2-SKIPS-OWN-REALITY.md)）：hy2 拨号在丢 UDP 的网络上失败时错误多为超时（`Tcp` 类），
  `transport_matches` 只在 QUIC 类失败时认可「换回 TCP」，同节点 Reality 又与 hy2 块地址、端口、SNI 相同，于是被排除，自愈换到另一节点。
  现在当前拨号是 hy2 时，任何非鉴权失败都认可换回同节点 Reality（排第 0）。TCP 拨号失败的排序不变。
- 新增/优化：无。没有新协议、不碰节点 443、不碰 WFP；鉴权失败仍不重试同一身份。
- 工程与测试：tono-core 新 `#[test]` `a_hy2_dial_that_timed_out_goes_to_the_same_nodes_reality_block`（旧规则下得到「Los Angeles · Harbor」，已验证失败）。
- 验证：Linux orb：`cargo test --ignore-rust-version --locked -p tono-core` 347 + 15 passed；clippy（CI 同参数）无告警。托管 Windows CI 为准。
- 候选/发布：仅源码，无新候选。
- 剩余限制：自愈目标只用于下一次手动连接；释放后的无隧道探测不考虑 hy2，也不优先本节点 Reality；真机 UDP 被丢的错误文本未在现场取样。
