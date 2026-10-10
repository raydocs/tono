## 2026-10-10 · H1-F5：macOS 控制面放行只在路径尝试期间存在（≤ 15 s）
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，Amp 待办 A30（[amp-backlog-2026-10-10](../ops/amp-backlog-2026-10-10.md) §6，D4-A）；macOS helper、macOS app。
- 来源：origin/main `ff824206` 起，分支 `amp/a30-bootstrap-window`，PR [#1507](https://github.com/raydocs/tono/pull/1507)；未合 main。
- 缺陷修复：H1-F5 macOS 一半。以前保护开着而没有隧道时（连接前的引导、断网保护），helper 的 PF 一直放行 API 主机的固定地址（TCP 443，
  root 与当前用户 UID），同 UID 的非 Tono 进程在断网保护期间可到达共享 anycast。现在这条放行（规则文字不变）移进子 anchor
  `tono.killswitch/control`，父规则在原位置只留 `anchor "control" all`（仅无隧道且有 API 地址时渲染）。`TonoAPIClient`
  每次路径尝试（系统解析、固定地址；中继不在放行内）前向 helper 取窗口（`POST /killswitch/control-window`），尝试应答、
  失败或取消后立即归还（`/killswitch/control-window/close`）；helper 在窗口打开 15 s 后自行撤回，加入不延长；过期窗口的
  放行在开新窗口前先撤回，不会滚进新期限。撤回 = `pfctl -a tono.killswitch/control -F rules` 加按地址杀 PF 状态，不写文件，
  也碰不到父规则；失败时 1 s、2 s 退避重试并大声记日志，绝不升级为紧急全封或释放。睡眠和释放时关闭全部窗口；helper 启动时
  先清空子 anchor。Tailscale 控制主机的放行不变。H1-F5 记为 accepted-design（已知风险，窗口 ≤ 15 s），见决定
  [086](../decisions/086-2026-10-10-h1f5-control-window.md)。
- 新增/优化：helper 协议 4.52.44 → 4.52.45（两条新路由，更新进行中也允许，因为只比以前更窄）；窗口内的系统解析尝试先
  `URLSession.flush()`，避免复用上个窗口被杀掉状态的连接。
- Windows：未改。Service 的 bootstrap API 通道已绑定 Tono 程序 AppId（#334），非 Tono 进程任何时候都不匹配；加计时需要
  新的 Service IPC 修订且不缩小 H1-F5 暴露面（决定 086）。
- 工程与测试：helper `--self-test` 新增 `runControlWindowSelfTest`（父规则只引用子 anchor、子 anchor 只含原放行；尝试期间
  存在、成功后/失败后/硬上限后不存在；重叠尝试、不延长、旧租约不能关新窗口；过期后重开先撤回；写文件失败时撤回照常；
  撤回失败只重试 flush、不碰父规则、恢复后撤回；关闭全部；启动清空；隧道旁不引用）；`--lifecycle-self-test` 用 pfctl
  实测子 anchor 加载/清空且父规则与其 block 不受影响；既有自测改为断言子 anchor 引用与子规则。XCTest
  `testTheControlWindowIsHeldOnlyWhileAnExchangeRuns`、`testASlowFirstPathDoesNotStarveThePinnedPathOfItsControlWindow`
  （假时钟）。CONTRACT.sha256 更新。独立评审第一轮 4 个 major（PR 评论）在此修正。
- 验证：Linux orb 只做源码检查；Swift/helper 自测与 XCTest 由托管 macOS CI 运行（见 PR 的 ci-gate）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：窗口内（≤ 15 s）同 UID 进程仍可到达共享 anycast 的 TCP 443（PF 无程序身份）；尝试超过 15 s 时失去放行、
  按失败处理；pfctl 一直不可用时撤回只能持续重试（父规则的全封不变）；未实机验证。
