## 2026-10-10 · hy2 三网公共探针与握手探测脚本（A16 第 1 步）
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)；[Amp 待办](../ops/amp-backlog-2026-10-10.md) A16（D2-A）。影响运维工具与文档，不影响客户端、控制面、节点。
- 来源：基线 `main` a504ca31；分支 `amp/a16-hy2-probe`，PR 见本条目所在 PR；未合 main。
- 缺陷修复：无。
- 新增/优化：[`docs/ops/transport-hy2.md`](../ops/transport-hy2.md) 新增 2026-10-10 节：经 Globalping 公共探针（无账号），移动 AS9808 / 电信 AS4134 / 联通 AS4837 各 3 个探针，对 Niagara、Erie、Grove、Marina 四台 hy2 节点测 ICMP、TCP 443 建连、UDP 443（hy2 端口）与 UDP 对照端口路径；45 条 hy2 端口路径 39 条到达主机门口，三台 Dedirock 的对照端口主机应答。另观察到移动经 CMI 到三台 Dedirock 的 TCP 443 建连需 SYN 重传（均值 1.1–4.4 s），电信、联通与移动到 Marina 正常（只是观察）。证据 JSON 在 `docs/ops/evidence/2026-10-10-hy2-carriers/`。新增 `tooling/ops/hy2/globalping_carriers.py`（复跑测量与汇总）和 `tooling/ops/hy2/hy2_probe.py`（官方 hysteria 客户端做真实握手，证书须与目录 fingerprint 一致、`insecure: false`，测试账户 UUID 从 0600 文件读、不打印），以及握手结果待填表。
- 工程与测试：`services-ci.yml` 的 service-agents 作业加跑 `tooling/ops/hy2` 的两条 unittest，push 路径加 `tooling/ops/hy2/**`；`ci-gate-changes.test.mjs` 同步路径表。
- 验证：Linux orb，`python3 -m unittest discover -s tooling/ops/hy2 -p 'test_*.py'` 2 条通过；`node --test tooling/scripts/tests/ci-gate-changes.test.mjs` 7 条通过。`hy2_probe.py` 对本机 hysteria v2.12.2 服务端（摘要与 `provision-reality-node.rb` 钉的一致）实跑：正确口令 3/3 ok、错误口令 auth-rejected、无监听 timeout、错 SNI tls、证书与指纹不符拒绝。未执行：任何节点上的握手（本轮无 SSH）、三网家宽握手、吞吐。
- 候选/发布：仅源码与文档，无新包；未部署、未改节点、未写 D1。
- 剩余限制：公共探针的 UDP 载荷不是 QUIC，不能证明 hy2 握手或绕过 QUIC 识别；三网 `ok | throttled | blocked` 仍未判定，G2.8 / A17 自动切换的前提不变。节点本机自检安装待做（no SSH from orb）；Harbor、Canyon 无库内 IP 未测；Sunset、Mesa 的 hy2 现状未知未测。家宽三网握手需要老板提供的探测点。
