## 2026-11-27 · 按节点目录可选下发 Hysteria 2 下行 `down-mbps` 与服务端热控

- 归属：G1/G2 桌面端 + 控制面 + 节点运维（Option C 第 2 步）；分支 `feat/hy2-per-node-down-mbps`。
- 来源：`origin/main` → 本分支（按所有者在 2026-11-27 拍板的方案 C 实现，参见 [决策 141](../decisions/141-2026-11-27-hy2-per-node-down-mbps-opt-in.md)）。
- 缺陷修复：无（不带硬编码全局 `50/200` Brutal）。
- 新增/优化：
  1. **控制面目录校验**：[catalog-yaml.ts](../../services/control-plane/src/catalog-yaml.ts) 对 ` · hy2` 条目放行可选块级整数字段 `down-mbps`（范围 `10..500`，禁止引号/尾注释/嵌套/flow-mapping/重复键，VLESS 禁止携带），默认未填写时行为零变化。
  2. **Windows 核心**：[node.rs](../../apps/windows/crates/tono-core/src/node.rs) 与 [sing_box/runtime.rs](../../apps/windows/crates/tono-core/src/sing_box/runtime.rs) 读取可选 `down-mbps`（`10..=500`）并仅在存在时写入 `sing-box` `hysteria2` outbound 的 `down_mbps`；永不发射 `up_mbps`，上行保持自适应 QUIC+BBR；未配置节点行为与之前逐字节一致。
  3. **macOS 客户端**：[ProxyNode.swift](../../apps/macos/Tono/Models/ProxyNode.swift)、[ConfigParser.swift](../../apps/macos/Tono/Services/ConfigParser.swift)、[ConfigPipeline+Nodes.swift](../../apps/macos/Tono/Core/Configuration/ConfigPipeline+Nodes.swift)、[ConfigPipeline+SingBoxProduct.swift](../../apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift) 解析并校验 `down-mbps`（越界安全降级为 nil 回落 BBR），仅输出可选 `down_mbps`、`up_mbps` 永不输出；不触发 `HelperProtocolVersion` 升级或 helper 重编。
  4. **服务端热开关**：[manage-tono-hy2-node.sh](../../tooling/scripts/remote/manage-tono-hy2-node.sh) 新增 `set-bandwidth`（支持 `--ignore-client-bandwidth true|false`、`--up-mbps`、`--down-mbps`，校验变更、保留权限、自动回滚并断言 `tono-xray` PID 不变）。
- 工程与测试：补充控制面 [catalog-yaml.test.ts](../../services/control-plane/test/catalog-yaml.test.ts)、Rust [node.rs](../../apps/windows/crates/tono-core/src/node.rs) / [runtime.rs](../../apps/windows/crates/tono-core/src/sing_box/runtime.rs)、Swift [SingBoxConfigTests.swift](../../apps/macos/TonoTests/SingBoxConfigTests.swift) 与 [test_manage_tono_hy2_node.py](../../tooling/scripts/tests/test_manage_tono_hy2_node.py) 单元测试。
- 验证：本地运行控制面测试、`tono-core` + `tono-windows` 单测、`swiftc -parse`、`sing-box check`、`tono-core-helper --runtime-contract-check`、脚本单测、`records.mjs` 与 `git diff --check`；原生 macOS `xcodebuild test` 与 Windows `service` 套件由托管 `ci-gate` 执行。
- 候选/发布：仅源码 Draft PR，不发布或部署生产。
- 剩余限制：当前 `0.0.88` 生产目录暂未开启任何节点的 `down-mbps`，上线前需在 `Los Angeles · Mesa` 对 BBR 与 `down-mbps: 100` 做真机 A/B 验证。
