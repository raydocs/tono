## 2026-10-10 · macOS：无隧道时控制面请求只走 Tono 中继（决定 091）
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)（控制面可达）；所有者 2026-10-10 经 Puck 决定（决定 091，修订 086 的路径顺序）。
  Windows 同一决定见 `amp/win-relay-only-without-tunnel`。
- 来源：基线 main `2ad39dba` → 分支 `amp/mac-relay-only-without-tunnel`。
- 新增/优化：没有隧道承载控制面时（未武装：未登录、首次登录、已断开；武装无隧道：bootstrap、Protected Offline、掉线恢复），
  `TonoAPIClient` 的 API 请求只走中继，不再先试系统解析或 Cloudflare 固定地址，中继全部失败也不回退直连，错误逐个写明中继与失败方式。
  走路径途中隧道消失时，后面的直连步骤跳过。隧道在（`KillSwitchService.tunnelCarriesControlPlane`）时顺序不变、走隧道。
  旧 helper（没有隧道标记的旧记录）按有隧道处理，保持原顺序。原参数 `armedWithoutTunnel` 改名 `relayOnly`。
- 不改：更新器（发现/签名/安装包 GET 仍直连优先、中继后备）；登录前握手探测；TLS 主机名与证书校验；PF 规则。
- 工程与测试：`testUnarmedFirstSignInGoesToTheRelayOnly`（生产状态读取、未武装时系统与固定地址 0 次、中继 1 次）、
  `testATunnelLostDuringTheWalkSkipsTheDirectStepsStillAhead`（第一步时隧道消失，固定地址 0 次、中继应答）；原 086 测试改用新参数。
- 验证：本机不跑 Swift/XCTest，以托管 macOS CI（ci-gate）为准。
- 候选/发布：仅源码，无新候选。
- 剩余限制：中继集中在洛杉矶（DMIT 两台 + 第三台 #1538，同一地区）；全部中继不可达时未登录用户无法登录（所有者接受，明确报错，不静默回退）；
  国内真机未测；海外用户未连接时的控制面请求也绕经洛杉矶中继。
