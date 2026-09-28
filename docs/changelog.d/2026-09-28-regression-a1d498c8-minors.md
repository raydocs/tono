## 2026-09-28 · 合并回归审查 a1d498c8 的三条 minor；环境审批改由 agent 自行批准
- 归属：SHIP_PLAN G2（macOS 连接与恢复：MAC-BOOT-AUTORESUME 的续修与派生缺陷）与 G1（Windows 安装门禁日志），
  §2 第 10 条冻结期修复；发布流程文档（RELEASE_LINES、DECISIONS）。合并回归审查 run `a1d498c8`
  （区间 `e2aff1a3...ccbc50a8`，triple）通过，确认三条 minor，按停止规则修一轮。影响 App `RuntimeCleanup.swift`、
  `AppState.swift`，Windows service `core/update/gate.rs`，测试 `UnexpectedRestartResumeTests.swift`、
  `install_service/update_executor.rs`。发现 MAC-BOOT-AUTORESUME（续修）、MAC-BOOT-AUTORESUME-notice、CRa1d4-opus-F1。
- 来源：基线 origin/main `ccbc50a8`；分支 `fix/regression-a1d498c8-minors-20260928`；红提交（仅测试）`edc7119f`（macOS，
  另推为分支 `…-red-mac`）、`335c4d2c`（Windows；同内容 cherry-pick 到 main 上为 `5f6a98e1`，推为分支 `…-red-win`）；
  修复提交 `6836703d`（grok:F2）、`7302599d`（codex:F1）、`9d7d0aaf`（opus:F1）。PR [#677](https://github.com/raydocs/tono/pull/677)。
- 缺陷修复：
  - MAC-BOOT-AUTORESUME 续修（grok:F2）：开机记录只写 UserDefaults，cfprefsd 异步落盘，连接后几秒内 panic 会丢记录、下次
    开机照样自动连接，循环可能继续。改后 `recordConnectBootSession` 另写 `Application Support/Tono/connect-boot-session`
    （同目录临时文件 `O_EXCL|O_NOFOLLOW` 0600，`F_FULLFSYNC`（不支持时 `fsync`），rename，再同步目录）后连接才继续；
    `recordedConnectBootSession` 先读文件，没有文件时仍读旧 UserDefaults 键（旧版本留下的记录照样保持），文件在但读不出
    时返回哨兵 `unknown`（保持）；完成释放时两处都删。写文件失败时保留 UserDefaults（即旧行为），删掉不等于本次记录的
    旧文件，并记审计事件 `connect_boot_session_not_synced`。UserDefaults 仍照写，降级到只读它的旧版本不受影响。
  - MAC-BOOT-AUTORESUME-notice（codex:F1）：恢复回调带着启动时读到的恢复意图；外部恢复已释放 PF 且 App 已接受后，
    迟到的回调仍会设「等待用户操作」暂停并显示「Kill Switch 仍在拦截」。改后 `acceptCloudOnlyTransport` 只在
    `KillSwitchService.isArmed` 仍为真时接受该意图（确认的释放会清掉它），提示和暂停另需 helper 确认的屏障
    （`isProtectionBlocked`）；未确认时只取消自动连接请求，保持照样拦住自动连接。
  - CRa1d4-opus-F1（opus:F1）：受保护日志写不了时，提升的安装门禁改写用户 TEMP 下的 `install-gate.log`（创建、追加、
    轮换），该目录由同一用户的中完整性进程控制。去掉这个兜底：`GateReport` 只剩 ProgramData 日志，写不了就不写文件日志。
    reason 文件第二行照旧是「(the install-gate log could not be written)」；NSIS `TonoGateExplain` 读 reason 文件两行，
    第二行非空就原样显示在「日志」行，只在 reason 文件缺失时回退到 `%PROGRAMDATA%\Tono\logs\install-gate.log`，不依赖
    TEMP 路径，所以 NSIS 不改。
- 新增/优化：发布流程（所有者决定 2026-09-28，[DECISIONS](../DECISIONS.md) 状态 owner）：GitHub Actions 环境审批
  （`windows-release` 任何候选、G4 的 `windows-update-channel`）由 agent 自行批准，每次在 changelog 记运行链接、环境、
  候选 SHA 与 release sequence；客户发布前提不变（所有者在 SHIP_PLAN §6 为 G1–G2 写 `[x]`，只发该证据点名的候选）。
  [RELEASE_LINES](../RELEASE_LINES.md#customer-publish-g4) 已改。
- 自行批准记录：
  - 2026-09-28 首次：[windows-release run 36383440146](https://github.com/raydocs/tono/actions/runs/36383440146)，环境
    `windows-release`，`release/windows` @ `ccbc50a8`（#675、#676），0.0.74 sequence 7422，内部候选，不是客户发布。
    审批 API 记录 `raydocs` approved（批准备注写明 seq 7422 与来源）；写入本条时该运行仍在进行中。
- 工程与测试：XCTest `UnexpectedRestartResumeTests.testConnectRecordSurvivesALostPreferencesWrite`（记录后删掉
  UserDefaults 键模拟没落盘，仍读回本次记录；清除后为 nil；只有旧键时读旧键）与
  `testRestartHoldIgnoresAResumeThatAConfirmedReleaseSuperseded`（确认屏障时照旧提示并暂停；确认释放之后的迟到回调
  不提示、不暂停、不请求自动连接）。Windows `#[test]`
  `update_executor::tests::update_manual_gate_skips_the_log_it_cannot_write_in_the_protected_root`（`logs` 是文件、主日志
  写不了：根目录只剩 `logs` 与 `reason.txt`，reason 第二行是「未写日志」）。修复提交里两处测试删掉被移除的
  `fallback_log` 字段（编译需要，断言未改）。
- 验证：本机只做 `swiftc -parse`（三份 Swift 文件）、把 `writeSynced` 抽成独立脚本 `swiftc -typecheck`
  （`-default-isolation MainActor`）并运行一次（写两次、删除、目录无残留临时文件），以及 `rustfmt --edition 2024 --check`
  （`gate.rs` 无差异；`update_executor.rs` 仅有与本次无关的旧格式差异）。未本机编译或运行 XCTest/cargo。
  - 红 macOS `edc7119f`：macOS CI [push 36385847625](https://github.com/raydocs/tono/actions/runs/36385847625) 失败，
    `build` 的 448 个 XCTest 中只有两条新用例失败：`testConnectRecordSurvivesALostPreferencesWrite`
    （`XCTAssertEqual failed: ("nil") is not equal to ("Optional("8E22…")")`）与
    `testRestartHoldIgnoresAResumeThatAConfirmedReleaseSuperseded`（暂停为真、`errorMessage` 是重启保持提示）；
    是新断言，不是编译错误；helper 与 policy 作业通过。
  - 红 Windows `5f6a98e1`：Windows CI [push 36385845528](https://github.com/raydocs/tono/actions/runs/36385845528) 失败，
    `service` 作业唯一失败用例 `update_manual_gate_skips_the_log_it_cannot_write_in_the_protected_root`
    （`left: ["fallback.log", "logs", "reason.txt"]`，`right: ["logs", "reason.txt"]`）；core、app、app-rust 通过。
  - 修复头 `96a1cdbc`：macOS CI [push 36386377442](https://github.com/raydocs/tono/actions/runs/36386377442) 通过
    （448 个 XCTest，1 跳过、0 失败，三条 `UnexpectedRestartResumeTests` 都通过）；Windows CI
    [push 36386377524](https://github.com/raydocs/tono/actions/runs/36386377524) 通过（新用例与原
    `update_manual_gate_refusal_names_its_cause_in_the_log_and_the_dialog` 都通过）。本条续记之后的头只改文档，
    另手动触发两条 CI。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机验证（panic 后记录是否在、提示是否可见、Windows 对话框「日志」行）。连接开始时在主线程做两次
  `F_FULLFSYNC`，耗时未在真机测（CI 上含一次记录的用例共 0.015 秒）。launch 判定「未确认」而后才被 helper 确认为屏障时，不补显示重启保持提示（只看到 Protected
  Offline）。重启保持期间唤醒/网络变化的拒绝仍是静默的；Home-US 路径无提示（R675-opus-F1，仍 open）。NSIS reason 文件
  本身在 `$PLUGINSDIR`（用户 TEMP 下），仍为 `create_new` + 不跟随最后一级重解析点，本次未改。

### 续记 2026-09-28 · #677 评审 8a9e6ebd 的一条 minor（一轮修复）
- 沿用证据：只改文档的头 `5796f5ec` 上手动触发的 Windows CI [36387579678](https://github.com/raydocs/tono/actions/runs/36387579678)
  通过；macOS CI [36387577256](https://github.com/raydocs/tono/actions/runs/36387577256) 第 1 次 `privileged-tests` 失败于
  helper `--lifecycle-self-test` 的 `reference-kept-past-unanswered-query`（本 PR 未动 helper，同一代码在 `96a1cdbc` 通过），
  只重跑失败作业一次，第 2 次全部通过；视为偶发，未另查。
- 缺陷修复（MAC-BOOT-AUTORESUME 续修，codex:F1）：记录目录可读不可写、文件不存在时，连接只记审计事件照常进行，panic 丢掉
  尚未落盘的 UserDefaults 后下次启动仍自动连接。改后 `recordedConnectBootSession(in:)` 在既无文件也无 UserDefaults 记录、
  而文件所在目录不可写（`FileManager.isWritableFile`）时返回哨兵 `unknown`，`AppState.init` 于是设重启保持：不自动连接，
  PF 保持，走已有提示路径；用户的 Connect 照常并解除保持。没用 UserDefaults 里的「写失败」标记：它与记录一样异步落盘。
- 工程与测试：`testConnectRecordSurvivesALostPreferencesWrite` 加一条断言（临时目录权限 0500、无文件无旧键时读出哨兵），
  测试改为 `throws`。与修复同一提交，没有单独的红提交（新入口在旧代码上只会是编译错误）。
- 验证：本机 `swiftc -parse` 与一段独立脚本（0500 目录下读文件报 no-such-file、`isWritableFile` 为 false、清理成功）；
  macOS CI 结果见下一条续记或 PR。
- 剩余限制：这种不可写的机器上每次启动都保持（同一次开机内崩溃也不自动恢复），提示文案仍说「意外重启」，可能与实情不符；
  目录可写但写入失败（如磁盘满）时旧缺口仍在。
