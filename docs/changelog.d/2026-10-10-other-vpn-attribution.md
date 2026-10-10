## 2026-10-10 · 两端识别其他 VPN/TUN，连接失败归因写「存在其他 VPN」（H21-O-F7）
- 归属：ops 任务（[运维计划](../ops/plan-2026-09-11.md)，[Amp backlog](../ops/amp-backlog-2026-10-10.md) A10）；macOS App、Windows App 与 tono-core、控制面诊断入口。
- 来源：origin/main `4e373f06` → 分支 `amp/a10-other-vpn-detection`，[#1480](https://github.com/raydocs/tono/pull/1480)；未合 main。
- 缺陷修复：另一个 VPN/TUN 在跑时，连接失败只显示通用句（「连接没有完成」或 TUN/出口类句子），诊断报告也看不出（H21-O-F7）→
  - macOS：App 进程 `getifaddrs` 只读识别 `utun*`/`ipsec*`/`tun*`/`tap*` 中已启用、带 IPv4 或非链路本地 IPv6、且不是 Tono 的 `utun199` 的接口
    （系统自带 utun 只有 fe80:: 不算；`ppp*` 不算，PPPoE 宽带也是 ppp）。分类为 `TUN_ROUTE_UNAVAILABLE`、`CORE_EXIT_UNREACHABLE`、
    `PROTECTED_DNS_NOT_READY` 的连接失败改显示「存在其他 VPN：这台 Mac 上还有别的 VPN 在运行，可能与 Tono 冲突。请先退出它，再重新连接。」
    hy2 空闲与时钟错误的句子优先；助手、账户、目录、离线等失败不改。
  - Windows：App 进程 `GetIfTable2` 只读读取适配器表（不经 Service），`tono_core::other_vpn` 判定已启用、别名不是 `Tono`、
    驱动描述带 Wintun/WireGuard/TAP/OpenVPN/VPN 等标记或类型为 `IF_TYPE_PROP_VIRTUAL`（排除 Microsoft 自带隧道、WAN Miniport、
    虚拟机/容器/抓包适配器）的适配器。网络/TUN 类失败码（`TONO_CONNECT_*` 网络类、`TONO_TUN_*`、`TONO_NODE_OR_CORE_UNREACHABLE`、
    `CORE_EXIT_UNREACHABLE`，或无码但按连接文本分类为网络类）在 `fail_connect` 记录失败之前给错误文本末尾追加 `[TONO_OTHER_VPN_PRESENT: …]`，
    首个错误码（遥测码）不变；仪表盘用新键 `tono.dashboard.errors.otherVpnPresent` 显示「存在其他 VPN：…」。
    Service、BFE/WFP、账户、时钟、策略类失败与 hy2 空闲码不改归因。文本只带数量，不带适配器名。
  - 诊断报告：两端 `virtualAdapters` 在识别到时多一个类别 `otherVpn`（从不上传接口名）；控制面诊断入口白名单加 `otherVpn`。
- 新增/优化：无路由、PF/WFP、助手协议或连接决策改动；读失败、超时（Windows 2 s 预算）或重叠读取一律当作没识别到。
- 工程与测试：tono-core `other_vpn::tests::an_up_foreign_vpn_adapter_is_named_on_a_tunnel_failure_only`；
  macOS `OtherVPNDetectionTests.testAnUpForeignTunnelNamesTheOtherVPNOnATunnelFailureOnly`；
  控制面 `accepts the otherVpn adapter class from a client that saw another VPN (H21-O-F7)`。
- 验证：本机 Linux：tono-core 该 `#[test]` 通过（rustc 1.95 加 `--ignore-rust-version`；CI 用固定工具链）；tono-core clippy
  `-D warnings` 通过；控制面该 `it` 通过。未在本机运行：Swift/XCTest、Windows Tauri crate 的编译与测试、前端 vitest/typecheck，交由托管 CI（ci-gate）。
- 候选/发布：仅源码，无新候选。部署顺序：带本改动的客户端发布前，控制面须已部署（旧入口会以 400 拒绝含 `otherVpn` 的诊断上传）。
- 剩余限制：未实机。macOS 不识别 PPP 类 VPN（L2TP/PPTP）；Windows 不识别系统自带 RAS VPN（PPP 类型，与 PPPoE 无法区分）。
  其他 VPN 刚断开、Tono 自己的 Wintun 在改名窗口内（别名尚未是 `Tono`）时可能误判一次。标记表是启发式，未覆盖的厂商适配器
  （非 Wintun、描述不含标记）不会被识别。
