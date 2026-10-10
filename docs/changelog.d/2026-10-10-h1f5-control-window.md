## 2026-10-10 · H1-F5：macOS 无隧道 armed 时控制面只经 Tono 中继（决定 086 Option A）
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，Amp 待办 A30（[amp-backlog-2026-10-10](../ops/amp-backlog-2026-10-10.md) §6，D4-A → 所有者改选 Option A）；macOS helper、macOS app、中继配置测试。
- 来源：origin/main `3d973f95` 起，分支 `amp/a30-bootstrap-window`，PR [#1507](https://github.com/raydocs/tono/pull/1507)；未合 main。
- 缺陷修复：H1-F5 macOS 一半。以前保护开着而没有隧道时（连接前的引导、`restrictToBootstrap`、断网保护、更新的
  `retainBootstrap`），helper 的 PF 放行 API 主机的 Cloudflare anycast 地址（TCP 443，root 与当前用户），同 UID 进程可经这些
  共享地址按 SNI 到达任何 Cloudflare 站点。现在这一状态下的控制面放行只剩编译进 app 与 helper 的两个 Tono 中继
  （`ControlPlaneRelays`：`179.253.233.220:2053`、`179.255.154.17:2053`，TCP，`user <uid>`，标签 `tono-api-relay`，去掉 root）；
  Cloudflare 地址（内置、学到、解析到的）在任何 armed 状态都不放行；已连接仍无控制面放行。离开旧规则时按地址杀掉
  Cloudflare 状态；隧道 arm 撤回中继放行时，只放过 Core 正在作为出口拨的那个中继地址。app 在无隧道 armed 时
  （`KillSwitchService.isArmedWithoutTunnel`）控制面请求只走中继，更新器的发布主机 GET 与包下载也直接走中继；TLS 仍以真实
  主机名作 SNI、默认证书校验。未 armed 与已连接时路径顺序不变。≤ 15 s 窗口方案放弃：macOS PF 没有内核级放行到期
  （xnu 源码核查，见决定 [086](../decisions/086-2026-10-10-h1f5-control-window.md)），两版用户态窗口实现存档于
  `amp/a30-userspace-window-archive`（`d62b5ba2`）。
- 新增/优化：helper 协议 4.52.44 → 4.52.45；`ControlPlaneRelays.swift` 加入 helper 构建清单与 build-source 测试。
- Windows：未改（WFP 放行已绑定 Tono 程序 AppId，#334）。决定 077 的中继由 086 修订为 macOS 无隧道 armed 时唯一的 API 路径。
- 工程与测试：helper `--self-test` 新增 `runControlRelayPermitSelfTest`（无隧道规则只含两条中继 :2053、tcp、`user 501`，
  无 Cloudflare 地址、无 root；已连接无放行；旧规则的 Cloudflare 状态被杀；隧道 arm 杀中继状态但放过同时是出口的
  中继）；既有自测改断言中继放行、隧道规则禁止中继与 API 地址、新增无隧道规则的 PF 解析；`--lifecycle-self-test` 用真实
  pfctl 加载无隧道规则并读回中继放行。XCTest `testArmedWithoutATunnelTheRequestGoesToTheRelayOnly`；更新器测试显式
  传入未 armed。`tooling/ops/relay/test_relay_stream_conf.py` 静态校验 SNI 白名单只有 api/releases、默认拒绝、只监听
  2053、TLS 不终止（services-ci 改为 discover 跑该目录全部测试）。CONTRACT.sha256 更新。
- 验证：Linux orb：`python3 -m unittest discover -s tooling/ops/relay -p 'test_*.py'`（3 项通过）、
  `apps/macos/scripts/test_build_source.py`（2 项通过）、CONTRACT 哈希经 `build-core-helper.sh` 自身校验；只读实测两个中继：
  `-servername www.npmjs.com` 无证书（连接被关），`-servername api.afk.ccwu.cc` 得 `CN = afk.ccwu.cc`、校验通过。Swift、
  helper 自测与 XCTest 由托管 macOS CI 运行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无隧道 armed 时同 UID 进程仍可经中继到达 Tono API/发布主机，无时间上限；两个中继都不可用时该状态下控制面
  不可达（fail-closed，可断开后直连）；helper 升级后到下一次 arm 之前旧规则仍在（app 升级后立即 arm）；未实机验证。
