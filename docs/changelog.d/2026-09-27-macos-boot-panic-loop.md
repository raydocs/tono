## 2026-09-27 · macOS：开机恢复不再装上无隧道的旁路放行；意外重启后不自动重连；Continuity 放行不留状态
- 归属：SHIP_PLAN G2（macOS 连接与恢复），§2 第 10 条冻结期修复（客户现场：候选包连接中用通用剪贴板后内核 panic，
  之后每次登录约 2 秒、安全模式下也反复 panic）。影响 helper `KillSwitchManager.swift`、`KillSwitchPF.swift`、
  `HelperProtocolVersion.swift`、`CONTRACT.sha256`；App `RuntimeCleanup.swift`、`AppState.swift`、`AppState+Connect.swift`、
  `AppSettings.swift`、`Localizable.xcstrings`。发现 MAC-BOOT-TUNNEL-PASS、MAC-BOOT-AUTORESUME、MAC-PF-AWDL-STATE。
- 来源：基线 origin/main `6226b604`；分支 `fix/macos-boot-panic-loop-20260927`；红提交 `ac7f5b1f`（helper）、
  `e9747c5b`（App），修复提交 `730419e5`、`19d817d0`；评审修复 `8d5cbc92`（helper）、`3cd3e7a7`（App）；
  所有者加固（决策 c67708cf）红提交 `336dd8e1`（另推为分支 `fix/macos-boot-panic-loop-20260927-red-awdl`）、修复 `266be2dd`；
  PR [#675](https://github.com/raydocs/tono/pull/675)，未合 main。
- 缺陷修复：
  - MAC-BOOT-TUNNEL-PASS：helper 启动（每次开机，登录前）按 `killswitch.state` 原样恢复 PF，连同上次会话的 utun199，
    于是在没有 TUN 时装上 Continuity（awdl0/llw0/bridge100）、mDNS、LAN、link-local、DHCP、NDP 放行。改后
    daemon 启动、`status()` 自愈和 supervisor 修复三条从磁盘重装 PF 的路径都经 `restorableState` 渲染：只保留此刻存在的
    utun（`if_nametoindex`），开机时为空，渲染出无隧道形态；会话中 helper 重启、TUN 仍在时保持不变。只减少放行。
    过滤只在渲染时做，不写回磁盘：磁盘保留上次 arm 的意图，App 连接时带实时接口 arm，省略该字段的 arm 回退行为不变。
    自愈/修复两条路径由 #675 评审补上（codex:F1 = opus:F2）。
  - MAC-BOOT-AUTORESUME：启动时只要 helper 仍要求 PF 就自动重连，意外重启后每次登录都重复同一会话。改后连接开始时记下
    `kern.bootsessionuuid`（App 自己读 sysctl，不加 IPC；读不到时记哨兵 `unknown`，它不等于任何真实 boot，下次启动照样
    保持），完成释放（恢复正常网络、退出）时删除。`AppState.init` 在任何自动连接能写记录之前比较记录与当前 boot，
    不同则设 `automaticResumeHeldAfterRestart`：启动恢复、网络变化重连循环、唤醒恢复都拒绝自动连接，PF 保持（Protected
    Offline）；启动恢复请求时另设已有的「等待用户操作」暂停并显示中英文提示。用户的 Connect、「修复并重新连接」/Retry now
    解除并记下本次开机；完成释放也清除。同一次开机内崩溃重开照旧自动恢复；没有记录时行为不变。决策提前到 init 和哨兵
    由 #675 评审补上（opus:F1；codex:F2 = opus:F3）。
  - MAC-PF-AWDL-STATE（所有者 2026-09-27：实机复现前先加固）：六条 Continuity 放行（awdl0/llw0/bridge100 进出）从
    `keep state (if-bound)` 改为 `all no state label "tono-continuity"`，PF 不再在 macOS 按需创建、销毁的接口上保留绑定
    接口的状态条目。放行集合不变：进、出各有一条放行；渲染出的规则集中它们是这些接口上最先能命中的规则（前面只有 lo0
    两条，都是 `quick`），所以这些接口上的 mDNS、link-local、NDP、LAN 流量照样由它们放行，只是不建状态。`no state label`
    写法与已有的入站 `tono-dhcp` 放行相同。utun 的 `tono-tunnel`、mDNS、LAN、link-local、DHCP、NDP 规则、顺序、标签和
    PF 令牌逻辑都没动。
- 新增/优化：无。
- 工程与测试：helper `--self-test` 检查（从磁盘恢复在 utun 不存在时不渲染任何隧道专用标签、不出现 utun199；存在时保留），
  覆盖三条重装路径共用的 `restorableState`；三条路径本身要 root 和 pfctl，非 root 自测驱动不了。XCTest
  `UnexpectedRestartResumeTests.testLaunchResumesAutomaticallyOnlyInTheBootThatStartedTheSession`（评审后多一条哨兵断言）。
  自动路径的门控（init 决策、循环/唤醒拒绝）没有测试：要搭起 AppState 的就绪、网络变化和唤醒状态，不算便宜。
  Continuity 自测的针原来钉住旧的 `keep state (if-bound)` 文本，改为六条 `no state` 全文，并断言没有 Continuity 行保留状态，
  失败时打印自己的一行；其余依赖规则文本的地方不受影响：lifecycle 自测只查 `tono-continuity` 标签存在（按规则计数，与状态
  无关）和每条规则带标签，`passRules(in:)` 只按 `pass ` 前缀收集，`withdrawnHosts` 对接口规则本来就返回 nil（整表清状态，
  与之前相同），`reviewedBundleWithholding` 只比较集合和 `tono-bundle` 标签，`childAnchorActive` 只找 `block drop out quick all`。
  Helper 合约 4.49.0 → 4.50.0（评审修复和加固仍在本 PR 内，版本不再升）；CONTRACT.sha256 按 `build-core-helper.sh` 同一管道重算
  （该管道在 origin/main 上复现 `d1a9c834…`），未本机编译。
- 验证：
  - 红 helper `ac7f5b1f`：[run 36379051036](https://github.com/raydocs/tono/actions/runs/36379051036) 失败，`build` 与
    `privileged-tests` 都在 helper 编译后的 `--self-test` 报 `self-test: boot restore rendered a tunnel-only pass without a
    tunnel` 退出 1，是新断言，不是编译错误。
  - 红 App `e9747c5b`：[run 36379053268](https://github.com/raydocs/tono/actions/runs/36379053268) 失败，唯一失败用例
    `UnexpectedRestartResumeTests.testLaunchResumesAutomaticallyOnlyInTheBootThatStartedTheSession`
    （`XCTAssertTrue failed - A session started in an earlier boot must not auto-connect`）；helper 与 policy 作业通过。
  - 修复头 `b9c0fa23`：macOS CI [push 36378958540](https://github.com/raydocs/tono/actions/runs/36378958540) 与
    [PR 36379059228](https://github.com/raydocs/tono/actions/runs/36379059228) 通过。
  - 评审修复后的头 `7a70cace`：macOS CI [push 36380279569](https://github.com/raydocs/tono/actions/runs/36380279569) 与
    [PR 36380282810](https://github.com/raydocs/tono/actions/runs/36380282810) 通过。
  - 红 Continuity `336dd8e1`：分支 `fix/macos-boot-panic-loop-20260927-red-awdl` 手动触发
    [run 36380924567](https://github.com/raydocs/tono/actions/runs/36380924567)（同分支的 push 运行被它取消）失败，`build` 与
    `privileged-tests` 都在 helper 编译后的 `--self-test` 报 `self-test: Continuity passes missing or keeping state with a
    tunnel` 退出 1，是新断言，不是编译错误。
  - 加固后的头 `b033cbe4`（含修复 `266be2dd`）：macOS CI [push 36381056726](https://github.com/raydocs/tono/actions/runs/36381056726)
    与 [PR 36381060780](https://github.com/raydocs/tono/actions/runs/36381060780) 通过。其中 `privileged-tests` 的 root
    `--self-test`（`pfSyntaxAccepts` 对带隧道的规则集跑 `pfctl -nf`，无跳过警告、无 `pf syntax:` 报错）和 lifecycle 自测
    （把带 utun199 的规则集载入测试锚点，含 `labels-report-tono-continuity`）都通过，这证明 `no state` 形式能被 GitHub-hosted
    macos-26 的 pfctl 解析和载入；本机只做了 `swiftc -parse` 和 CONTRACT 管道重算。
- 候选/发布：仅源码，无新候选。
- 剩余限制：panic 根因未证实（无 panic 报告，可能是 macOS AWDL 自身缺陷），不能声称修好 panic，只去掉了两处已确认会让循环
  持续的我方行为，并把 Continuity 放行改成不留状态（我方最可疑的触发点，同样未证实）；安全模式下 helper 是否运行未核实。
  `no state` 之后，这些接口上的每个包都要逐条过规则集（没有状态快速路径），性能影响未测。UserDefaults 异步落盘，连接开始后几秒内的 panic 可能丢失记录，仍会
  自动重连一次。重启保持期间唤醒/网络变化的拒绝是静默的，只有启动恢复路径显示提示。launch 判定为「未确认」时界面不显示
  「修复并重新连接」，提示里的按钮名可能对不上（用户仍可点 Connect）。测试宿主用 `.standard` 默认值：在开发机上跑测试时，
  真实 App 留下的另一次开机记录会让测试进程的自动连接保持（CI 每次新虚拟机，不受影响）。需实机验证：重启后
  `pfctl -a tono.killswitch -sr` 无 awdl0/utun199 规则；意外重启后不自动连接且提示可见。
