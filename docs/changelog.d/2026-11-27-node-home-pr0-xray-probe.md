## 2026-11-27 · PR 0：Xray `v26.3.27` / `v26.11.9` 住宅 SOCKS5 节点下沉能力探针
- 归属：Ops 专项（[Node-Side Residential SOCKS5 RFC](../proposals/node-side-residential-socks5.md) PR 0 准入门槛）；影响模块 `tooling/ops/node-home/`、`.github/workflows/services-ci.yml`、`tooling/scripts/tests/ci-gate-changes.test.mjs`。
- 来源：`main @ 6d85f43a5` → 分支 `feat/node-home-pr0-xray-probe`。
- 缺陷修复：无。
- 新增/优化：新增离线/回环可复现 Python 标准库探针 [probe_xray_capabilities.py](../../tooling/ops/node-home/probe_xray_capabilities.py) 与单测 [test_probe_xray_capabilities.py](../../tooling/ops/node-home/test_probe_xray_capabilities.py)，并在 [2026-11-27-xray-node-home-capabilities-probe.md](../reports/2026-11-27-xray-node-home-capabilities-probe.md) 记录 `v26.3.27` 与 `v26.11.9` 的逐项实测结论（含 `adrules` 全量原子替换、`domainStrategy: "AsIs"`、9 条私网 CIDR + catch-all 阻断、`u:`/`h:` 独立计量、h2c `RoutingService/TestRoute` 可用性，以及 **两者 `rmo` 均不主动断开已建立 TCP 长连接** 故依 RFC §7.1 保留解绑换密门禁）；在 `.github/workflows/services-ci.yml` 接入自动测试与触发路径。
- 工程与测试：同步补齐 `test-suite-reachability` 对 `tooling/ops/node-home/` 路径与单测步骤的覆盖。
- 验证：`Darwin arm64` 本机使用 `.dgst` SHA-256 校验通过的官方 `v26.3.27` 与 `v26.11.9` 二进制（空 `XRAY_LOCATION_ASSET`）跑通全部 7 项实测并退出 `0`；本地单测、reachability 与 `*.test.mjs` 通过（详细输出见 `services-ci` 与探针报告）；Linux `x86_64` 实机复核留待 PR 2/PR 4 金丝雀。
- 候选/发布：仅源码，无新客户端候选，未部署 Worker 或修改生产 D1。
- 剩余限制：因 `v26.3.27` 与 `v26.11.9` 下 `rmo` 均不会切断已建立的长连接，PR 1 起 `node_only` 住宅线路解绑继续要求上游换密（`migrations/0080`），不采用重启 `tono-xray` 兜底。
