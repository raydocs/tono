## 2026-10-10 · macOS helper 的 networksetup 回退加期限（MAC-HELPER-NETWORKSETUP-UNBOUNDED）
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)；所有者要求的 helper 挂起/死锁/永久断网审计）；macOS 特权 helper `tooling/scripts/core-helper/`。
- 来源：基线 origin/main 437b6138；分支 `amp/helper-networksetup-deadline`，PR [#1542](https://github.com/raydocs/tono/pull/1542)；未合 main。
- 缺陷修复：`ProtectedDNSManager.runNetworkSetup` 在 System Configuration 读写失败时回退到 `/usr/sbin/networksetup`。它原来用 `waitUntilExit()` 无期限等待，
  等完才读输出。这一步跑在 helper 唯一的请求/看门狗线程上，同时持有更新锁和 DNS 锁。非阻塞 `SCPreferencesLock` 发现别的写者时正好走这条回退，
  而 `networksetup` 自己会等那个写者；子进程卡住时，Disconnect、其他请求和 Core 已停的释放都一起卡住。改为走 `KillSwitchManager.run`：
  期限与 `pfctl` 相同（15 s），超时先 SIGTERM 再 SIGKILL，并按命令失败处理（DNS 快照保留，调用方或看门狗重试）；输出边跑边读，不再有管道写满的死等。
- 新增/优化：`KillSwitchManager.run` 增加可选 `environment` 参数（默认值不变），`networksetup` 仍使用 `LC_ALL=C`。签名与 #1504 的同名参数一致。
- 工程与测试：helper `--self-test`（`ProtectedDNSManager.runSelfTests`）新增 `runNetworkSetupDeadlineSelfTest`：用忽略 SIGTERM 的子进程
  （`/bin/sh -c "trap '' TERM; exec /bin/sleep 30"`）代替卡住的 `networksetup`，期限 1 s，要求调用失败并在 6 s 内返回。helper 4.52.44 → 4.52.45，`CONTRACT.sha256` 重算。
- 验证：Linux orb：`sh tooling/scripts/test-core-helper-contract-guard.sh` → `PASS build-core-helper contract guard`；`python3 apps/macos/scripts/test_build_source.py` → `OK`；
  用 Python 核对了测试用子进程的信号行为：收到 SIGTERM 后仍在运行，SIGKILL 后返回码为 -9。Swift 编译与 `--self-test` 由托管 macOS CI 执行，本机未执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未在真机复现 `networksetup` 卡住。执行器与更新路径里的 `UpdatePackage.run`（launchctl、ditto、open）仍无期限，属于另一条发现，
  见审计报告的剩余风险；#1504 只在 `--emergency-disarm` 进程内给它们加了期限。
- 续记（Sol 终审 e8e0f012：1 major）：期限原来从 `Process.run()` 返回之后才开始，`run()` 是同步调用，启动本身卡住（可执行文件 I/O、启动校验）时
  没有任何超时，迟到的启动还会拿到一整段新期限。`KillSwitchManager.run` 现在先算出绝对期限，在独立线程上启动；到期仍未启动即按命令失败，
  之后才返回的子进程立即 SIGTERM（1 s 后 SIGKILL），其退出码绝不当作结果。`runBoundedSystemLookup`（dscacheutil）改走同一个执行器，
  启动与等待共用单调时钟期限。新增自测 `runStalledLaunchDeadlineSelfTest`（启动卡 2.5 s、期限 1 s：2 s 内失败，迟到的子进程被终止并回收）。
  合并 main 后 helper 4.52.47 → 4.52.48，`CONTRACT.sha256` 重算。`UpdatePackage.run`（launchctl/ditto/open）的期限由 A13（#1504）修复轮统一处理。
