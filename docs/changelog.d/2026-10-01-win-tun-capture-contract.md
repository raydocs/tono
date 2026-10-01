## 2026-10-01 · Windows owned runtime 必须把流量留在 TUN 上

- 归属：G1 保护不得放宽；影响 Windows Service（`apps/windows/service` `runtime_generation/owned_config.rs`）。
- 来源：基线 `origin/main` `33d46892` → 本分支 `cursor/win-tun-capture-contract-f6c6`；[#917](https://github.com/raydocs/tono/pull/917)；提交时未合 main。
- 缺陷修复：StartClash/StageRuntime 会接受一份看起来仍是 `strict-route` + `MATCH,Tono-Exit` 的 YAML，但 `udp` 不为真、`tun.auto-route` 不为真，或 `route-exclude-address` 不是本文档 VLESS/Hysteria2 出口的 IPv4 `/32`。改后这三类在取生命周期锁、武装 WFP 之前拒绝（`InvalidRuntimeAsset`）。App 生成的出口 `/32`（含住宅节点第二条约）仍通过。见 `docs/findings.d/W8-G-F1.md`。
- 新增/优化：无。
- 工程与测试：新增 `the_service_refuses_a_runtime_that_leaves_traffic_off_the_tunnel`。
- 验证：Linux 云代理，`rustup run stable cargo test --locked --features standalone,client --lib owned_config::tests`（工作目录 `apps/windows/service`）。两条均 ok：`the_service_refuses_a_runtime_that_leaves_traffic_off_the_tunnel`、`the_service_refuses_runtime_yaml_outside_the_owned_contract`。实机 WFP / 装路由未执行。
- 候选/发布：仅源码，无新候选、无新包。
- 剩余限制：不重推规则正文（中国 DIRECT / 住宅规则仍由生成器与 WFP 端点约束负责）。未在 Windows 上装路由或观察 WFP。needs-hardware。
