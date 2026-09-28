## 2026-09-27 · macOS：开机恢复不再装上无隧道的旁路放行；意外重启后不自动重连
- 归属：SHIP_PLAN G2（macOS 连接与恢复），§2 第 10 条冻结期修复（客户现场：候选包连接中用通用剪贴板后内核 panic，
  之后每次登录约 2 秒、安全模式下也反复 panic）。影响 helper `KillSwitchManager.swift`、`HelperProtocolVersion.swift`、
  `CONTRACT.sha256`；App `RuntimeCleanup.swift`、`AppState.swift`、`AppState+Connect.swift`、`AppSettings.swift`、
  `Localizable.xcstrings`。发现 MAC-BOOT-TUNNEL-PASS、MAC-BOOT-AUTORESUME。
- 来源：基线 origin/main `6226b604`；分支 `fix/macos-boot-panic-loop-20260927`；红提交 `ac7f5b1f`（helper）、
  `e9747c5b`（App），修复提交 `730419e5`、`19d817d0`；PR 待开，未合 main。
- 缺陷修复：
  - MAC-BOOT-TUNNEL-PASS：helper 启动（每次开机，登录前）按 `killswitch.state` 原样恢复 PF，连同上次会话的 utun199，
    于是在没有 TUN 时装上 Continuity（awdl0/llw0/bridge100）、mDNS、LAN、link-local、DHCP、NDP 放行。改后
    `restoreAtLaunch` 渲染 `launchRestoreState(saved)`：只保留此刻存在的 utun（`if_nametoindex`），开机时为空，
    恢复出无隧道形态；会话中 helper 重启、TUN 仍在时保持不变。只减少放行。过滤结果不写回磁盘：磁盘保留上次 arm 的意图，
    App 连接时带实时接口 arm，省略该字段的 arm 回退行为与之前完全相同。
  - MAC-BOOT-AUTORESUME：启动时只要 helper 仍要求 PF 就自动重连，意外重启后每次登录都重复同一会话。改后连接开始时记下
    `kern.bootsessionuuid`（App 自己读 sysctl，不加 IPC），完成释放（恢复正常网络、退出）时删除；启动恢复请求遇到
    另一次开机的记录时不自动连接，改用已有的「等待用户操作」暂停（网络变化和唤醒恢复都遵守），PF 保持（Protected
    Offline），显示中英文提示，用户点「修复并重新连接」即连接并记下本次开机。同一次开机内崩溃重开照旧自动恢复；没有记录时行为不变。
- 新增/优化：无。
- 工程与测试：helper `--self-test` 新检查（启动恢复在 utun 不存在时不渲染任何隧道专用标签、不出现 utun199；存在时保留）；
  XCTest `UnexpectedRestartResumeTests.testLaunchResumesAutomaticallyOnlyInTheBootThatStartedTheSession`。两者各先以红提交落地
  （最小骨架让检查可编译、以断言失败）。Helper 合约 4.49.0 → 4.50.0；CONTRACT.sha256 按 `build-core-helper.sh` 同一管道重算
  （该管道在 origin/main 上复现 `d1a9c834…`），未编译。
- 验证：MacBook 上只做了改动 Swift 文件的 `swiftc -parse`、`Localizable.xcstrings` JSON 校验和 CONTRACT 管道复现。helper 编译与
  `--self-test`、TonoTests 未在本机运行（执行位置规则），待 GitHub-hosted macos-26 CI：红提交应失败、修复提交应通过，均未证实。
- 候选/发布：仅源码，无新候选。
- 剩余限制：panic 根因未证实（无 panic 报告，可能是 macOS AWDL 自身缺陷），不能声称修好 panic，只去掉了两处已确认会让循环
  持续的我方行为；安全模式下 helper 是否运行未核实。`status()` 自愈和 supervisor 修复仍按磁盘状态（含旧 utun）重装，只在 PF
  不在过滤时触发，未改。UserDefaults 异步落盘，连接开始后几秒内的 panic 可能丢失记录，仍会自动重连一次。Home-US 路径
  `acceptTonoTransport` 每次启动仍自动连接。launch 判定为「未确认」时界面不显示「修复并重新连接」，提示里的按钮名可能对不上。
  需实机验证：重启后 `pfctl -a tono.killswitch -sr` 无 awdl0/utun199 规则；意外重启后不自动连接且提示可见。
