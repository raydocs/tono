# iOS：隧道确认状态与故障矩阵（第一批，实施中）

## 验收边界

- PR [#1672](https://github.com/raydocs/tono/pull/1672)，`feat/ios-singbox-horizon`；开工基线 `3ab870ef0b5f1c3ef3d4077e277435f2cd305cd5`，fetch 后与远端一致。
- 本批只处理状态真实性，不修改视觉、评分表、评审门槛、CI 分线或其他平台。
- 第一阶段仍为两份独立盲评各 ≥85、各分项 ≥70%、无否决；本文件没有自评分，也不是验收通过报告。
- iOS 是实验客户端，非 SHIP_PLAN 客户发布门；不合 main、不签包、不发布、不上传 TestFlight。

## 架构约束（实现完成后核对，不冒充已有行为）

1. **唯一权威是隧道事实，不是 App phase。** NE 的 connected 只证明系统会话状态，不证明 sing-box graph 存在；App 探测成功也不能替代 graph 确认。
2. **确认要绑定会话与代次。** 保存选择只是意图，不能显示为当前；跨重连、过期、超时、未知回复和晚到回复不能复活旧连接。已确认出口从目录消失时不得改称第一条线路为当前。
3. **App 不续签隧道事实。** 前台、探测和 UI 更新不能刷新 graph 确认时间；原子写与跨进程锁解决交错，但锁本身不是状态真实性证明。
4. **所有消费者保守投影。** Home、Details、Settings、线路、小组件、Control Center、Live Activity 使用同一权威事实；未知时不保留绿色地区、当前线路、已连接或确定的流量去向。离线保存设置可以展示为下次连接选择，不能称正在生效。
5. **心跳不是即时存活探针。** abrupt crash 后持久文件不能自己得知死亡；必须明确确认有效期、到期保守显示和系统刷新限制。模拟器不能证明 WidgetKit 准点调度，也不能证明 iOS NE 的故障检测时延。
6. **拒绝不等于未运行。** 以隧道返回的真实 running graph 为准；恢复失败必须停用正向声明；输入文件恢复义务在连续写失败后仍保留。

## 故障矩阵

下面列出当前可执行的 Foundation 覆盖。下列单测全部包含在根线程本机最终 `swift test`（110 tests，0 failures）中；UI 测试只编写、未运行。测试证明注入故障的逻辑结果，不证明真实 iOS 调度及网络行为。

测试路径均相对于 `apps/ios/TonoKit/Tests/TonoKitTests/`。

| ID | 故障／保守要求 | 确切测试符号 | 证据范围／缺口 |
|---|---|---|---|
| S01 | NE connected + probe ok，但无 graph 确认，不得显示已连接 | `ConfirmationTrackerTests.testAppLaunchedIntoARunningTunnelClaimsNothingUntilItAnswers` | 单测通过；Home／Details 两个新增 unconfirmed UI 测试未运行 |
| S02 | 引擎明确停止，后续 heartbeat/status 不能说 graph 正在运行 | `TunnelGraphTests.testACoreStopIsReportedAtOnceAndNoLaterBeatOrReplySaysItRuns` | 单测通过；实际 provider 回调及队列时延未验证 |
| S03 | reload 拒绝、恢复 A 成功，只称 A，不称请求 B | `ConfirmationTrackerTests.testARefusedRebuildThatRestoredTheGraphConfirmsTheOldRoutes` | 单测通过；真实 Libbox 拒绝未注入 |
| S04 | reload 和恢复都失败，heartbeat 不得回到 Connected | `TunnelGraphTests.testRebuildAndRestoreBothRefusedMakeTheHeartbeatSayRoutesStoppedNotConnected` | 单测通过，含真实临时磁盘 status 文件；不是实际 App Group/NE |
| S05 | reload/status 双无答，全表面撤销当前声明 | `RouteApplyTests.testNoReplyAndNoStatusIsUnconfirmedNotThePreviousModeInEffect`；`AppStatusTests.testAnUnansweredQuestionReadsUnconfirmedOnHomeAndWidgets` | 单测通过；lanes、Settings、line 等 UI 仍待模拟器 |
| S06 | App 被杀／挂起，不得用 App 写入续签隧道事实；重启先确认 | `SharedStatusTests.testAppWritesDoNotRenewACrashedTunnelsReport`；`ConfirmationTrackerTests.testAppLaunchedIntoARunningTunnelClaimsNothingUntilItAnswers` | 单测通过，模拟文件与新 tracker；没有执行真实 jetsam/App kill |
| S07 | 隧道无 stop write 崩溃，确认到期降为历史／未知 | `SharedStatusTests.testAppWritesDoNotRenewACrashedTunnelsReport`；`ConfirmationTrackerTests.testTheConfirmationExpiresByTheTunnelsClock` | 注入时钟单测通过；仍有最长 15 分钟确认窗口，不能承诺即时 crash 检测 |
| S08 | Doze／长期无执行 | `ConfirmationTrackerTests.testTheConfirmationExpiresByTheTunnelsClock`；`ConfirmationTrackerTests.testAQuestionThatIsNeverAnsweredDoesNotHoldTheConfirmationPastItsExpiry` | iOS 无 Android Doze；单测仅证明挂起等价的时钟推进后保守投影，sleep/wake 与系统刷新须真机 |
| S09 | 重连、旧答及旧 probe 不能复活／破坏新会话 | `AppStatusTests.testAfterAReconnectNeitherHomeNorWidgetsUseTheEarlierStartsReport`；`ConfirmationTrackerTests.testExitChecksOfAnEarlierGraphDoNotCertifyTheOneConfirmedNow`；`RouteApplyTests.testAReplyAfterTheSessionEndedCannotPutOldInputsBack` | 单测通过；真实断网／On Demand 重连未运行 |
| S10 | App／隧道并发写不得丢掉 stopped，也不得覆盖对方字段 | `StatusFileTests.testAppDecidingWhileTheTunnelWritesDoesNotOverwriteIt`；`StatusFileTests.testWriteWaitsWhileAnotherProcessHoldsTheLock` | 单测通过；真实临时文件、线程 barrier、Python 子进程锁握手，无 sleep/耗时判定；不是实际 iOS 两进程 |
| S11 | put-back、重试、新请求 save 连续失败，恢复义务保留 | `RouteApplyTests.testAPutBackStaysOwedWhenTheNextRequestCannotWriteTheFileEither` | 单测通过；App UI 的 unsaved 文案待模拟器 |
| S12 | 出口不匹配时不能补旧名／第一线路 | `SharedStatusTests.testTheExitIsNamedOnlyForTheNodeTheTunnelRuns` | 跨 node 的共享出口命名单测通过；App `currentLine` 精确匹配目录的路径仅源码核对，没有专用 UI 执行证据 |
| S13 | 消息回调永不来／timeout 后晚到，只完成一次且确认不能永远续命 | `ProviderReplyTests.testATunnelThatNeverRepliesIsNoAnswerWhenTheTimerFiresAndALateReplyIsDropped`；`ConfirmationTrackerTests.testAQuestionThatIsNeverAnsweredDoesNotHoldTheConfirmationPastItsExpiry` | 注入 scheduler 单测通过；实际 NE callback、App expiry Task 尚未运行 |
| S14 | 新无答后旧成功答、旧 graph／旧 heartbeat 不能反向恢复确认 | `ConfirmationTrackerTests.testAnEarlierPositiveReplyCannotUndoALaterUnansweredQuestion`；`ConfirmationTrackerTests.testSilenceDoesNotEraseTheLastKnownGraphGeneration`；`SharedStatusTests.testALateBeatCannotMoveTheSameGraphConfirmationBackwards` | 根线程红→绿与最终全套通过；原始 red 保留 |


## 状态误导否决逐条映射

- r9 GPT：切换被拒仍展示新模式；旧 graph 被 libbox 关闭后错误声称旧图继续运行 → S02、S03、S04。
- r10 Opus 与 GPT：重建和恢复皆拒后 heartbeat 写 running，系统组件重新显示 Connected → S02、S04、S10。
- r11 GPT F2（否决），Opus F2（同缺陷、不判否决）：双无答仍在 Details 写确定去向及旧绿色地区 → S01、S05、S12。
- r11 GPT F4／Opus F3：App 旧状态覆盖隧道停止，或进程内旧心跳回写 → S07、S09、S10。
- r11 GPT F3：后续 save 失败丢失 put-back 义务 → S11。
- r8 两份原文均未判状态否决；不把复盘概述误记为 r8 的实际判决。Android r7/r8 的通知误导只作为 S06–S09 的故障启发，不声称本 PR 修复 Android。
- 这些缺陷在当前基线已包含部分 r12 修复；本批重新检查当前源码，不按 r11 旧行号重复打补丁。已有测试名称只表明源码存在，不表示本机执行通过。

## 证据分层

**本地 Foundation 单测可证明：** 确认 reducer、会话隔离、有效期、并发文件合并、拒绝与恢复、连续写失败；不需要 simulator runtime 或 Libbox。

**模拟器可证明：** DEBUG fixture 下 Home／Details／Settings／线路的保守文案与选择、widget view/gallery、ActivityKit 展示与 stale UI、点按线路和切模式。不能证明真实 NE、App Group entitlement 或系统小组件端到端更新。

**必须由所有者批准后真机／签名包／受控服务验证：**
- [ ] 签名安装与 App Group，真实小组件和 Control Center 读同一份确认事实；intent 操作后核对真实 graph。
- [ ] 真实 NE 的启动、重连、主动 reload 被拒、恢复失败、core crash、App 被杀，记录事件到保守 UI 的时延；不要记录账号或节点凭据。
- [ ] 锁屏／后台／睡眠唤醒／低电量下 heartbeat、widget timeline、Live Activity 的到期行为；系统调度延迟必须实测，不能从 unit clock 推断。
- [ ] 控制真实服务、DNS／IPv6／UDP、On Demand 及保护状态；模拟器不运行 packet tunnel。
- [ ] VoiceOver 真人听读、触觉、ProMotion、内存／功耗；截图与 fixture 不代替这些证据。

真机步骤执行前先列设备、签名、测试账号、预计时间、当前 VPN 配置备份及恢复方式，再等所有者确认。本批不操作任何系统 VPN 配置。

## 本机最小依赖与推送门

核对：Xcode 26.6（17F113）、iOS Simulator SDK 26.5、Node v26.12.0、XcodeGen 2.46.0、Go 1.27.2；无 simulator runtime／device，无 Libbox 框架／私有构建缓存，剩余约 57 GiB。系统 Java 只是 stub，没有 JDK；Android 缺件不属于此 iOS 工作的安装需求。

1. 所有者安装一个 iOS 26.5 arm64 runtime：`xcodebuild -downloadPlatform iOS -buildVersion 26.5 -architectureVariant arm64`。预计下载 8–12 GB、安装 15–20 GB，准确大小以 Xcode 显示为准；不要下载全部平台。
2. Libbox 必须按 `apps/ios/supply-chain/build-libbox-apple.sh` 的固定工具链构建（已有系统 Go 不能替代它固定的私有 Go 1.26.8）。另预留缓存 3–6 GB、framework／DerivedData 3–6 GB；这些为预算估计，不是实际测量。脚本会替换自身私有缓存子目录和产物，先确认专用路径，不复用用户其他缓存；未经确认本批不执行下载／构建。
3. 安装前建议完成 Time Machine 备份；不清模拟器、不清用户数据、不移除 worktree、不安装系统 VPN。源码和工作区保持原样。
4. 本地测试绿后才允许推送；推送前再次 fetch 确认远端未变，且上一轮 CI 已完成。当前基线两次 CI 均 success：39211006109、39211010708；不能把它们作为新代码证据。
5. 冻结 SHA、CI 全绿后才开两份新鲜独立盲评；评审只给 rubric 和 base...SHA，禁读历史 agent-reports；评审期间不推送。此批尚无冻结、无新 CI、无新评分。

## 集成核对收据（未冻结）

- 根线程本机实际运行基线 `swift test --package-path apps/ios/TonoKit`：74 tests，0 failures。
- Opus 首次实现返回后，根线程同命令实际运行：94 tests，0 failures。**这不是实现已通过验收**：App 仍直接使用 tracker/ConnectionState，而系统展示使用 SharedStatus，两个来源可能在新心跳、较新 stopped 与 status 无答时分歧。
- 根线程添加三个回归并实际运行：3 tests，5 failures，均为行为断言失败（不是编译失败或 skip）：
  - `ConfirmationTrackerTests.testAnEarlierPositiveReplyCannotUndoALaterUnansweredQuestion`：较新无答后，较早正向回复被接受，unknown 重新变为 graph。
  - `SharedStatusTests.testAnUnconfirmedReadingNeverHasAnOnSwitch`：通用 reading.switchOn 为 true，而同 reading 的 wording.switchOn 为 false。
  - `SharedStatusTests.testALateBeatCannotMoveTheSameGraphConfirmationBackwards`：同代次较早 beat 未被拒绝。
- 原始输出位于 `2026-10-19-ios-state-authority-receipts/`。红测对象是本批未提交的第一版实现，**不是历史基线 3ab870ef**；后续绿测必须重新记录。
- 一次集中修正已委派 Opus：上述三个红测、统一 App/public resolver、跨 session 晚到 reload 的副作用、无答的消息 timeout/独立过期、旧 graph 探测结果、coreStopped 即时停止事实、确定性文件锁测试。
- 尚未编译 App／PacketTunnel／Widgets，尚未运行本批 UI 测试；无模拟器 runtime，无 Libbox，不使用 CI 代跑。

### 登录恢复后的续接

- 所有者确认此前中断来自登录问题，组件尚未安装；本批继续不依赖 runtime／Libbox 的实现和 Foundation 测试，不推送未本地验证的代码。
- 根线程重新 `git fetch origin` + `git status --short`：HEAD 和远端分支仍为 `3ab870ef0b5f1c3ef3d4077e277435f2cd305cd5`；原先未提交的源码、三项红测和报告均保留。
- 读取旧修正任务结果：`status: failed`，原文 `Claude gave up after repeated API errors.`，无 pending child runs。不是已完成的代码修正，不能算一次修复验证失败或盲评结果。
- 新修正任务已接受并运行：Opus 5.5/high，implementation，`delegate_task`、async/shared，仅 `apps/ios`。clientRequestId `ios1672-state-authority-correction-20261019-auth-retry-v2`。
- 任务完成后由根线程先跑三项红测，再跑完整 TonoKit；App／扩展编译及模拟器 UI 仍保留为未执行，不用 CI 代跑。

### 修正返回后的根线程核验（仍未冻结）

- Opus 修正返回后，根线程实际重跑原三项红测：3 tests，0 failures；再跑完整包：108 tests，0 failures。不是仅引用子任务报告。
- 根线程继续发现并修正两条局部交错：
  1. silence 清空 answer 后，也丢失了最后确认的代次比较基准；后续较旧 graph 回复可能重新被接受。新增 `testSilenceDoesNotEraseTheLastKnownGraphGeneration` 实际红：1 test，2 assertion failures；修正为独立保存最后 tunnel word，silence 只撤销展示确认，不撤销代次栅栏。
  2. `RouteApply` 在 await 后会先 put-back，外层 `tracker.settle` 才拒绝旧回复，判定太晚。现在每次 await 回来，写任何恢复文件前先运行同一 tracker 的无副作用 permits 判定；过期会话的回复既不回写也不查询新会话。新增 `testAReplyAfterTheSessionEndedCannotPutOldInputsBack`。对这一条，原 API 缺少 gate，未声称在历史源码上跑红；另在私有临时 package 中仅移除两个 gate，执行负控，收据单独保留。
- 局部修正后两项回归通过；根线程最终完整包 **110 tests，0 failures，exit 0**，不含 App/UI/NE。
- 未提交的第一版、Opus 修正版和根线程修正版分别保留原始日志，历史失败没有被改写成最终通过。
- 仍不能声称状态工作完成：App／PacketTunnel／Widgets 尚未原生编译，新增 UI 未运行；实际 coreStopped 通过队列发布的时延、系统 timeline/Control 刷新、ActivityKit 更新、签名 App Group、真实隧道都尚未验证。当前 5 分钟 heartbeat／15 分钟有效期意味着无 stop-write 的进程死亡仍可能有最长 15 分钟旧确认窗口，且系统刷新时延必须另测。

## Owner 更新：切换 Devin Cloud（2026-10-19）

此前「等待安装组件／本地验证后才能推送」仅作为历史记录保留，现已被所有者明确撤销：本机不再安装任何 runtime、镜像或 Libbox，也不继续构建／测试。先提交并推送 `wip/ios-state-authority`（不触发 CI），全部验证移至 Devin macOS 快照；云端检查及原始证据经根线程核对通过后，才允许将该 WIP 提交带回 PR #1672 分支。

外部检查清单：`~/.local/state/devin-cloud/briefs/ios-state-authority-r1.md`。首轮含真实 Libbox hash/provenance 验证、unsigned Release/device 编译、Debug simulator 编译、完整 110 项单测、S01–S14 逐项 filter、35 项 UI/无障碍及现有预览截图录屏。所有者要求 Dev​​in verify-only，不得代改产品代码。失败由本线程修复、同一 WIP 提交，优先 send 续接同一云会话。

云端最终结果仍须核对 exact commit、完整检查覆盖、测试数无减少、原始输出和真实附件；模拟器不能证明真实 NE、签名包或设备行为。后续在冻结 SHA 采集评审证据并发起全新双盲评，当前仍无新分数。


## 第1轮盲评后的状态修正（第2轮评分前，尚未云验）

本段只记录实现与待执行覆盖，不沿用 a20 的绿灯给新代码背书。PR 分支仍冻结 a20；先在 WIP 验证三个重大问题，之后再做文案/动效/Live Activity locale 收敛，不提前启动第2轮评分。

| ID | 故障／盲评映射 | 确切回归 | 本批结果 |
|---|---|---|---|
| S15 | GPT R1 F1：登出/新登录后旧 refresh/catalog/verify 回答，不得写回或借用他人缓存 | `AccountIsolationTests` 的9个受控响应测试，含 `testANewerVerificationDisownsTheEarlierRequestBeforeEitherAnswer`、`testLocalSignOutDoesNotWaitForTheLogoutServer` | 未执行；AppModel account epoch、apply/error/defer及本地登出接线仅静态核对；Keychain持久化还无专用回归 |
| S16 | GPT R1 F2/V1：C1/C2同mode/node而Home改变，运行图必须按隧道确认的catalog身份解释 | `CatalogConfirmationTests` 的5个测试，含 `testASameModeAndLineCatalogWithHomeExplainsNothingUntilTheTunnelBuildsItAndSaysSo`、`testTwoMissingCatalogIdentitiesNeverConfirmTheSharedExitName` | 未执行；共享记录双方缺digest也不得命名当前出口；旧SharedStatus fixture补显式同catalog身份，未删断言 |
| S17 | GPT R1 F3：配置discovery/save/reload暂停时Cancel或signOut，旧start不得迟到，也不得由旧cleanup关掉新start | `TunnelStartCoordinatorTests` 的6个测试，含 `testCancelDuringConfigurationDiscoveryCannotStartOrArmOnDemand`、`testSynchronousInvalidationBeforeAnAccountWaitDisownsAPreparingStart` | 未执行；App与外部intent共用串行生命周期，外部On的discovery已纳入；signOut同步作废start后再等待account actor |

新增 API 在旧代码上不能编译，不声称这是有效 red check。原生编译与130项单测、S01–S17、35项UI均须Devin实际输出。新增真机边界并入真机清单；不改变五分钟心跳/十五分钟确认窗口。
