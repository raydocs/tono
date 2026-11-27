## 2026-11-27 · 回退节点 Xray 至 v26.3.27 并加固 Windows post-lock 验证

- 归属：线上出口维护 + G1/G2 桌面端加固（Windows 客户端 + 节点部署脚本）；分支 `fix/post-0088-bugs-uiux-updater`，PR #1871（尚未合入 `main`）。
- 来源：PR #1871 基线 `fd8984b6d` → 本提交；不包含全局写死的 Hysteria 2 Brutal 带宽参数（按审查意见与方案 C 暂保留原生 QUIC+BBR，后续改用节点目录/服务端按需开启）。
- 缺陷修复：
  1. 节点端 Xray 版本回退锁定（`tooling/scripts/provision-reality-node.rb`、`tooling/scripts/provision-tono-node.py`、`tooling/scripts/NODE_PROVISIONING.md`、`tooling/scripts/tests/test_provision_tono_node.py`）：Xray `>= v26.9.8` 强制 X25519MLKEM768 REALITY 握手校验与 Tono 锁定的 `sing-box 1.15.0-alpha.12/13` 不兼容（导致客户端出现大量 TLS EOF 与握手超时），将新建脚本默认版本与架构校验和回退锁定至 `v26.3.27`；同步完成现网 3 台受影响节点（`Los Angeles · Mesa`、`JP-VLESS-Reality`、`San Jose · CloudSilk`）Xray 原子回退与 TLS 1.3 / D1 roster 核验。
  2. Windows `protected_probe` 与 `verify_post_lock` 根因保留及统一（`apps/windows/app/src-tauri/src/tono/protected_probe.rs`、`apps/windows/app/src-tauri/src/tono/connection/stages.rs`、`apps/windows/app/src-tauri/src/tono/connection/probes.rs`、`apps/windows/app/src-tauri/src/tono/connection/tests.rs`）：为独立 TUN 探针补充 `describe_error_chain` 完整嵌套错误链记录；将 `verify_post_lock` 统一应用至 `Stable` / `Three-tier` / `AI Home` 三种模式并显式传入 `session_mode`；当 `FAKE_IP_VERIFICATION_FAILED_PREFIX` 触发时先加盖 `TONO_CONNECT_DNS:` 再拼接 `; loopback proxy: ...`，防止 loopback 超时/TLS 失败文案覆盖 DNS 分类或误报为 `TONO_CONNECT_TUN`；在写入 `record_exit_delay` 前后同锁校验 `connect_generation`，防止旧代次 advisory 延迟污染新会话，并修正 `"loopback proxy egress"` 诊断文案。
- 新增/优化：无。
- 工程与测试：新增 `stale_generation_advisory_delay_does_not_pollute_newer_session` 异步单测，更新 `owned_graph_dns_anti_leak_failure_is_not_reclassified_as_tun_broken` 与 `exhausted_tun_failure_uses_the_independent_proxy_cross_check` 断言；更新 `test_provision_tono_node.py` 断言为 `v26.3.27`。
- 验证：本机已跑并将在推送后由 GitHub Actions `ci-gate` 在托管 Windows/macOS runner 上复验（具体命令与跳过项见 PR #1871 验证记录；本机跳过了绑定 `127.0.0.2:0` 在 macOS 宿主报 `AddrNotAvailable` 的 `late_failure_keeps_successor_auth_tunnel_port`，未本地运行 `xcodebuild` 与 Windows `tono-service` 套件）。
- 候选/发布：仅源码与线上 VPS 回退；尚无 `0.0.89` 候选包或客户频道更新。
- 剩余限制：PR #1871 为 Draft 状态（含 UI/安装链路改动，待后续实机验证后再由负责人放行合入与发版）；节点侧 SOCKS5 下沉优化与按节点可选 HY2 `down_mbps` 留待 `0.0.89` 之后单独推进。
