# Tono 内部更新记录

这份总账回答「内部这次更新了什么、修了什么、验证到哪里、哪个包包含它」。
它是变更入口，不取代 [SHIP_PLAN](SHIP_PLAN.md)、[运维计划](ops/plan-2026-09-11.md)
或各项原始验收记录。源码修复、合入 main、生成候选、实机通过、客户发布是不同状态。

## 维护规则（所有者要求，2026-09-23）

- 每次内部代码、配置、构建/测试工具或发布验收状态的有效交付，在同一个 PR 更新本页。
  新一轮记录放在旧记录前面；同一轮后续结果加带日期的续记，不覆盖原来的失败或未知。
- 分开写 **缺陷修复**、**新增/优化**、**工程与测试修正**。同一根因的续修、移植、测试和
  cherry-pick 不重复算新 bug；编译失败、fixture 错误不冒充客户运行时故障。
- 写清准确源码、分支/PR、归属门或 ops 任务；通过、失败、跳过、未执行和沿用证据分开。
  命令、主机、实际 CI checkout 与日志链接可引用已有详细报告，不复制多套验收事实。
- 内部包必须记版本、源码、标签/下载入口、包摘要、签名状态及包含/不包含的后续修复。
  没有新包就明确「仅源码，无新候选」；同版本号不表示相同字节。
- 纯咨询、只读审查无新成果、无行为影响的排版/拼写改动不制造空条目。文档整理不重跑
  产品测试，不改写旧证据为新 SHA 的测试结果，不记密钥、账号或原始诊断数据。
- 更新记录不是 merge、签名、部署、设备操作或推进客户更新源的授权。

### 后续条目模板

```text
## YYYY-MM-DD · 内部更新名称
- 归属：G1/G2/G3/G4 或已有 ops 任务；影响平台/模块。
- 来源：基线 → 实现源码 SHA（链接）；分支、PR；是否已合 main。
- 缺陷修复：原失败场景 → 改后行为；关联 Issue/回归或详细记录。
- 新增/优化：新增能力、保留行为与自行选择的边界；没有则写无。
- 工程与测试：编译/fixture/CI 修正，与产品缺陷分开。
- 验证：准确源码/checkout、主机、命令、决定性输出或证据链接；列未执行/沿用项。
- 候选/发布：无新包，或标签、包源码、下载入口、SHA-256、签名及发布状态。
- 剩余限制：尚未解决的问题/Issue、实机或外部依赖；不能声称什么。
```

## 2026-09-23 · shared-legacy 退役持久化到 Xray 静态配置（H7-F5）

- **归属**：ops 控制面 / 出口节点吊销执行；`services/exit-agent`。
- **来源**：基线 main def3dd79 → 分支 `fix/exit-agent-legacy-persist-20260923`（提交时未合 main）；内部审查 H7-F5，Issue #382。
- **缺陷修复**：(a) `retireSharedLegacy` 只经 API 从运行中的 Xray 删除 `shared-legacy`，它仍在 `config.json`，Xray 每次重启复活；现在退役时同时从静态配置删除（同目录临时文件、保留属主/权限、`xray run -test` 通过后原子 rename 并 fsync 目录），每轮检查，失败则本轮最终 Refusal（见下）。(b) 拿不到 live 用户列表、只能用记录清单时（退役后记录中已无它）不再跳过：退役态下总是对 `shared-legacy` 执行 rmu（"not found" 视为成功），不改变其他 client 的"清单未知不删"规则。(c) `TONO_RETIRE_SHARED_LEGACY` 大小写不敏感，接受 `1/true/yes/on`、`0/false/no/off`（原先 `True` 等被当成 false）。审查修正（R4）：其他值告警并**保持现状**（本轮不退役）——退役持久化后是单向的，`false` 撤不回，回滚时拼错不能触发它。静态配置写入失败不再挡 roster ACK 与用量上报：失败先告警，本轮在计量完成后才以 Refusal 退出（超额吊销依赖用量上报）。
- **新增/优化**：新环境变量 `TONO_XRAY_CONFIG`（默认 `/opt/tono-xray/current/config.json`），README 与 env 示例同步。
- **工程与测试**：一个 unittest（override=`True`、无 list 能力、记录清单不含 shared-legacy、服务端信号为 false → 仍 rmu `shared-legacy` 且 config.json 中只剩手工 client），在修复前代码上实际跑红；既有 `RosterControlSignals` 测试夹具补一行 patch 持久化函数。审查修正新增两个窄测试（同一夹具加 `persist_error` 参数）：`test_an_unrecognized_override_leaves_shared_legacy_in_place`（`flase` → 不退役；旧实现 `True is not false`）、`test_a_failed_retirement_write_still_meters_before_refusing`（持久化抛 Refusal 时仍 ack roster 与 metering、state 已保存、最终仍 Refusal；旧实现 `acknowledge_roster` 调用 0 次）。两者只还原 `reconcile_and_report.py` 时均失败。
- **验证**：MacBook 本机 `python3 -m unittest test_reconcile_and_report`（83 通过；审查修正后 `python3 test_reconcile_and_report.py` 85 通过）。未连接真实节点，未在真实 Xray 上验证空 clients 的 vless inbound 能否通过 `run -test`（不通过时 agent 不写入、告警，本轮在计量后以非零退出；计量不停）。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：agent 运行用户需对 release 目录可写；只跑 `--hy2-roster-only` 或未配置 exit_nodes/agent 的节点仍不会退役 Xray 上的 shared-legacy，`device_only` 就绪门看不到这些节点（未在本 PR 处理）。退役后重跑 `enable-tono-exit-metering.sh` 会因 vless 无 client 而拒绝。退役对每台节点是单向的，恢复需 `.pre-metering` 备份或重新配置。

## 2026-09-23 · coreMonitor 不得把运行时替换的瞬时 utun 消失判为 TUN 死亡

- **归属**：G1（已连接=能用：切换/热重载不掉线）；macOS 客户端 `apps/macos`。
- **来源**：基线 main
  [576d7087](https://github.com/raydocs/tono/commit/576d7087cc54084acef3a4cda15c433ec96bb679)
  → 分支 `fix/macos-tun-switch-guard-20260922`（关联 PR，提交时未合 main）；
  R1-F1，出自 2026-09-22 macOS 连接生命周期并发/时序审查及对抗核实轮（已确认）。
- **缺陷修复**：切节点（`switchingNodeId`）/配置热重载（`configReloadTask`）/连接成功后的
  后台可选策略（同 `configReloadTask` 句柄）都经 helper `/core/sync` 以 stop+start 重启
  sing-box，utun199 消失 0.2–1.5 s 且 PF 全程 armed；`startCoreMonitor` 的 utun 存在性分支
  只做单次 `if_nametoindex` 判定（同循环 reassert/探测分支均有同款任务抑制，唯此分支
  没有），把正常替换窗口判为 "Protected TUN stopped"，fail-closed 断开+重连，表现为
  “连上/切换后几秒又掉线重连”。现在该分支：替换任务在飞时本 tick 不判死（与既有
  reassert 分支同款抑制）；且要求缺失连续两个 tick（`tunMissingVerdictTicks = 2`）才判死。
  真 TUN 死亡仍 fail-closed 断开，最多延迟一个 tick（2–5 s）确认，判定只延迟、不跳过；
  PF/Kill Switch 语义不变。
- **新增/优化**：为可测性给 `AppState` 加 `tunInterfaceExists` I/O seam（默认真实
  `KillSwitchService.interfaceExists`，生产行为不变），monitor 单次迭代从循环抽为
  `runCoreMonitorTick(state:)`（`CoreMonitorState`/`CoreMonitorTickOutcome` 承载跨 tick
  状态，循环只负责睡眠与退出）。无其他行为变化。
- **工程与测试**：新增一个窄 XCTest
  `AppStateCoreMonitorTests.testMonitorHoldsMissingTUNVerdictWhileRuntimeReplacementIsInFlight`
  （fixture：isConnected + `configReloadTask` 挂起任务 + `tunInterfaceExists=false` → 一次
  tick 不断开；清掉任务再 tick → 此时才进入断开）。XCTest 无法驱动真实特权 helper，
  seam 与 tick 抽取即为此设计；加 seam 但去掉守卫的旧实现会在第一段断言失败。
- **验证**：编辑机（MacBook，按 2026-09-14 执行位置决定）只编辑未编译未运行——未执行
  `xcodebuild`/`swift build`/`swift test`；Swift 语法与访问级别人工自查（结构迁移为纯代码
  搬移 + 控制流映射，未跑机器检查）。回归委托本 PR CI（GitHub-hosted `macos-26`，
  `macos-ci` 由 `apps/macos/**` 路径触发）；提交时 CI 结果未知，不沿用任何旧 SHA 的
  绿灯。准确受测源码为 PR head（基线 576d7087 之上的本分支提交）。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：替换窗口命中概率的实机量化未做；R1 审查其余发现（F2–F6）不在本条范围；
  真 TUN 死亡的判定延迟一个 tick 属本修复的有意权衡。
## 2026-09-23 · Windows 升级事务中断后无终态/误回滚的结构修复（F1/F4/F6）

- **归属**：G3 受保护升级中断恢复；Windows Service 更新事务
  （`apps/windows/service` 独立 workspace）+ 协议文档。
- **来源**：基线 main `576d7087` → 分支 `fix/windows-update-txn-recovery-20260922`；
  PR #301；提交时未合 main。
- **缺陷修复**（2026-09-22 并发/时序审查 + 对抗核实轮确认三项同根因：事务全部权威
  出口以精确进程 incarnation 为钥匙、唯一非 commit 终态只对 Install 前发起进程开放）：
  - **F1**（权限绑定单一 App incarnation）：Disconnect/退休 peer 谓词从 pid+started_at
    精确相等改为「owner 匹配 + 注册安装根路径 + 当前摘要为 old/target App 组件」；
    新增 `retire_rolled_back` 归档终态（已验证 Disconnect 且安装身份等于保留原件）。
    触发序：Prepare 持久化后发起 App 退出/执行器回滚（已终止发起进程）→ 重开 App 的
    全部出口被拒。
  - **F4**（successor 单 incarnation + 恢复一律回滚）：`classify_recovery` 三分支按
    「durable plan 是否存在 + 已装组件是否等于 signed target」判定；已等于 target 不
    回滚——successor 未登记的事务由恢复提升为 Replaced，首个 target 身份 App 经
    `authenticate_successor` 重绑收养；`service.start`/`wait_for_service_ready` 失败
    不再经 `SuspendedApp::drop` 终止已登记 successor。触发序：提交前退出新 App 或
    重启机 → 完整已校验安装被撤销且落入 F1。
  - **F6**（Launching 静默终态）：执行器 incarnation 空/死 ⇒ 消费可判定不可能 →
    `retire_unconsumed` 接受 Launching；`reconcile_before_desired` 将该状态置回
    Staged（同一发起 App 可再 launch，或经 Disconnect 退休），不二次授权执行。
- **新增/优化**：UPDATE_PROTOCOL_V1.md 新增「Interrupted-transaction recovery and
  terminal states (2026-09-22 clarification)」小节，只澄清不改变旧条款；U1 单次消费、
  U3 高水位不回退、U4 Disconnect 不伪造提交全部保持（退休只在证明未消费或已验证
  回滚到 old 时发生）。
- **工程与测试**：新增 4 个窄回归——`update_fresh_registered_app_incarnation_can_disconnect_and_retire_unconsumed_attempt`、
  `update_app_started_after_replacement_with_target_identity_is_an_adoptable_successor`、
  `update_launching_without_live_executor_incarnation_is_retirable_after_verified_disconnect`
  （以上在 update_transaction.rs，前三个在旧实现第一处 unwrap 必失败）与
  `update_recovery_classifies_publication_by_installed_identity_not_successor_liveness`
  （update_executor.rs 恢复判定纯函数）。既有
  `update_explicit_disconnect_archives_only_proven_unconsumed_attempts` 中「同注册路径、
  started_at+1 被拒」的断言改为异路径身份拒绝——原断言正是 F1 过度收紧的正面描述。
- **验证**：本机未运行任何 cargo（所有者 2026-09-14 执行位置决定，MacBook 只做
  编辑/审查）；全部委托本 PR 的 GitHub-hosted `windows-2025` Service lane：
  `cargo test --locked --features standalone,client,test` 及既有
  `update_transaction::tests::update_` / `core::update::tests::update_` /
  `update_executor::tests::update_` 定向枚举步。提交时未获得原生结果，不沿用上一轮
  main 的绿灯，也不声称未测代码已验证。
- **候选/发布**：无新包，仅源码。
- **版本生效边界**：升级时运行的 `executor.exe` 是 Prepare 时从**已安装旧版**
  `resources/tono-service-install.exe` 复制的，`--update-recover`/ONSTART 任务与发布前
  全部 Service 侧检查也由已装旧版 Service 执行。因此本 PR 对从 0.0.73（及任何不含本
  修复的版本）出发的首跳升级**不生效**（F4 恢复判定、F6 reconcile、F1 发布前半段均不
  适用），**不构成 G3 证据**；它保护的是从含本修复的版本出发的下一跳升级。
- **剩余限制**：
  - **未解决的独立问题（已存在，非本 PR 引入）**：Replaced 且已验证 Disconnect 仍永久
    pending、产品内无出口——连接、Adopt/Commit、再更新、Quit/登出释放、卸载/重装全部被
    拒（网络已释放，不泄漏流量）。这是可达性最高的产品锁死路径：升级后自动重连失败 →
    用户点 Restore internet 即触发。需单独设计「已安装+已释放」归档终态（不能把释放当
    commit，备份清理归属需明确），另立待办。
  - **跟进项（安装完整性缺口，无保护绕过）**：恢复判定（`classify_recovery`
    TargetVerified）与 `retire_rolled_back` 以三组件（Tono.exe / tono-core.exe /
    tono-service.exe）摘要代替整份 durable plan（整棵 payload 树 + `core-sha256.txt`，
    逐成员 `old_digest/new_digest`）成员校验；发布在二进制之后、后续成员之前中断，或
    回滚恢复了二进制而未恢复某资源时，会被判为全部发布/全部回滚。修法是逐成员校验。
  - 非 Windows 平台的 incarnation 探测编译为恒「已死」，只影响开发编译路径（该
    crate 测试仅在 windows-2025 lane 执行）；Windows 11 实机升级中断验收仍属 G3 未闭合
    证据。
- **剩余限制**：Replaced 且已验证 Disconnect（用户显式拒绝一个已完成安装）仍保持
  pending（不回滚也不退休），需后续单独判定；非 Windows 平台的 incarnation 探测编译
  为恒「已死」，只影响开发编译路径（该 crate 测试仅在 windows-2025 lane 执行）；
  Windows 11 实机升级中断验收仍属 G3 未闭合证据。
## 2026-09-23 · Windows PrepareCoreStart 绑定当前 release epoch（R2-F6）

- **归属**：G1 连接生命周期（I1：旧 attempt 的迟到 Service 副作用不得影响新会话）；
  平台/模块：Windows Service IPC 协议（`apps/windows/service`，App 侧无代码改动，
  客户端逻辑在 `tono-service-protocol` 内）。
- **来源**：基线 main 576d7087 → 分支 `fix/windows-prepare-start-freshness-20260922`；
  PR 与准确源码 SHA 见续记，提交本条时未合 main。
- **缺陷修复（R2-F6，源码确认 + 需实机级）**：被取消 attempt 的
  `POST /clash/prepare-start` 迟到数秒到达时，该路由只有 `Unchecked` owner 门、
  无会话/epoch 新鲜度令牌（对照 Lock/MarkVerified/Stop 均有会话门），且
  `is_protected_startup_replacement_candidate` 对后继连接未验证的 Core 为假，
  `prepare_start(false)` 会停掉后继受监督 Core，表现为一次莫名连接失败
  （fail-closed，不泄漏）。修复：协议 revision 17 起，客户端在发出该破坏性请求前
  经 `GET /version` 快照 Service 的 `RELEASE_EPOCH`（复用 StartClash 已有 epoch
  机制，不引入新令牌类型）并在请求内携带；Service 在 `OWNER_LIFECYCLE_LOCK`
  内比较，epoch 不等于当前 → 以新错误码 `StaleReleaseEpoch`(1013, HTTP 409)
  拒绝，拒绝发生在任何快照/操作发布/Core 停止之前，无半停止状态。合法路径
  （App 存活、期间无显式 release）行为不变。兼容：新旧混合配对时——新 App +
  旧 Service（<rev 17）由能力探测降级发送旧 `null` payload，行为同旧版；
  旧 App + 新 Service 的无 epoch 请求**被接受**，由 Service 在请求到达时自取 epoch
  快照、在锁内比较（与 StartClash 的到达时快照相同）。
- **审查修正（第二轮）**：初版对旧 App 的 `null` 请求一律 409，结果探测判定配对
  可用，之后每次连接都在 prepare 阶段永久失败，违反 `lib.rs` "Reject a
  mismatch at the protocol probe" 规则。没有把 `MIN_SUPPORTED_CLIENT_REVISION`
  提到 17：探测门 `require_protocol_version`（`server/mod.rs` 686-700，经
  `authenticate_request` 741 行）同样挡在 `ReleaseKillSwitch`/`StopClash`/
  `RestoreProtectedDns` 前面，提到 17 会让与新 Service 短暂共存的旧 App 无法
  释放 WFP、无法恢复 DNS。改为对 Legacy 采用到达时快照，旧 App 行为不比
  rev 16 差。
- **新增/优化**：`ProtocolInfo` 增加 `release_epoch`（`#[serde(default)]`，
  仅服务端 GetVersion 路由填充）；`PrepareCoreStartPayload` 采用与
  `StopClashPayload` 相同的 untagged `Legacy/Freshness` 线型。
- **工程与测试**：新增一个 Service 集成回归
  `late_prepare_core_start_superseded_by_release_cannot_stop_the_successor_core`
  （`tests/test_owner_lifecycle.rs`）：快照 epoch → 显式 release（真实 bump）→
  后继 StartClash（Core 未验证）→ 用旧 epoch 发 PrepareCoreStart → 断言返回
  `StaleReleaseEpoch` 且 `core_pid` 不变；若门被移除，后继 PID 断言失败。
- **验证**：本机（MacBook）按所有者 2026-09-14 决定只做编辑与源码自查，
  未运行 `cargo build/test/check/clippy`；回归委托本 PR CI 的 GitHub-hosted
  `windows-2025`（`cargo test --locked --features standalone,client,test`），
  结果以该 run 的实际 checkout 为准，不预支。R2-F6 的实机触发窗口
  （数秒级 IPC 在途延迟）未在 Windows 11 实机复现，维持原定级。
- **候选/发布**：仅源码，无新候选、无新包；未触碰 WFP/PF 规则、DNS 恢复语义、
  `appcast.xml`/`latest.json` 或 `windows-updates`。
- **剩余限制**：不 bump epoch 的取消路径不刷新令牌：StopClash(release=true)
  在无 armed 时为空操作；节点消失 `selected_node_vanished`（`stop_core(false)`，
  无 release）；更新安装的 `invalidate_connection(false)`；连接事务 240 s 超时。
  经这些路径取消的 attempt，其迟到 prepare 仍可能通过门，但触发条件比已修的
  Disconnect→重连序列更窄。修复只在 Service 也升到 rev 17 后生效：
  `MIN_REQUIRED_SERVICE_REVISION` 仍为 14，只升级 App 时新 App 对旧 Service
  发 Legacy，F6 未修。旧 App 配新 Service 时只拿到到达时快照，在途迟到请求
  仍会漏过（与 rev 16 相同）。Service 重启会把 epoch 归零，快照于重启前的请求
  被拒绝并表现为一次连接失败（fail-closed，重试即恢复）。第二轮修正同样
  本机未编译，委托 CI；已有回归测试走 Freshness 路径，不受本修正影响，未改。
- **剩余限制**：不 bump epoch 的拆臂路径（如 StopClash(release=true) 在无 armed
  时为空操作）不刷新令牌——经这些变体取消的 attempt 其迟到 prepare 仍可能通过
  门，但触发条件比已修的 Disconnect→重连序列更窄；Service 重启会把 epoch 归零，
  快照于重启前的请求被拒绝并表现为一次连接失败（fail-closed，重试即恢复）。
## 2026-09-23 · Windows connecting 期间到达的 policy 行为变更不再丢弃

- **归属**：G1「已连接=能用」——已连接会话应按最新已安装 policy 提供 DIRECT/WeChat
  直连覆盖，而不是把 connecting 期间到达的行为变更静默丢到下次手动重连（会话内一致性，
  属已连接行为，不占 G2 的失败下一手）。
- **来源**：基线 main [576d7087](https://github.com/raydocs/tono/commit/576d7087)，分支
  `fix/windows-policy-defer-connecting-20260922`（PR 见该分支）；提交时未合 main。
- **缺陷修复**：R2-F5（对抗核实降级为低后只修丢弃/延迟部分；原报告"UI 显示直连已开"
  被 V5 核实推翻——实际走 `skip_optional_direct_policy` 写 `optional_direct_skip`，
  UI 如实显示 directSkipped，故本条不改前端）。原行为：FSM 处于 Connecting 时
  `handle_policy_behavior_change → handle_network_change_inner` 入口守卫直接无操作且无
  任何待处理记录；连接成功后 `spawn_optional_direct_after_connected` 携带连接前捕获的
  旧 policy 快照，`direct_context_is_current` 比对 revision/digest 不一致 → 跳过 overlay，
  新 policy 的 DIRECT 授权本会话永不应用，直到下次重连（pin-refresh 的 wechat 腿也因
  `applied_wechat_path_regexes` 为 None 不补放）。现行为：connecting 期间的行为变更由
  `policy_change_disposition`（ReconnectNow / DeferUntilConnected / Ignore 纯判定）给出
  DeferUntilConnected 并在 `TonoInner` 记录 pending（记下该 attempt 的 connect
  generation）；每次代际退役（Disconnect、连接失败、账户关闭/切换、下一次 attempt 准入）
  都清除 pending，connect 提交块在 `connect_succeeded` 后只消费与本 attempt 代际相同的
  记录，其它一律丢弃，因此绝不会串到下一个会话或其他账户；判定时在同一锁下重新核对
  `sign_in_generation`。消费后用最新已安装 policy 重建快照再走 optional-direct 应用
  路径。若刷新后的 policy 含 DIRECT 内容而本次连接**从未尝试**接口发现
  （`needs_physical_interface` 为假，内容从无到有），改走与已连接时相同的受保护
  teardown + 重连，由新事务发现接口并安装新 policy；该兜底任务携带本 attempt 代际，
  入口处会话已不是该代际的 Connected 就退出。接口发现**已尝试但失败**（虚拟/Hyper-V
  默认路由常态）不触发兜底，仍走原 skip 路径保持全隧道。已连接时立即 teardown+重连、
  DIRECT 应用失败的 restrict/不重连收敛、policy 写锁与 DIRECT 激活读锁互斥的既有
  纪律均不变；不泄漏（跳过路径保持全隧道）。
- **新增/优化**：无新功能。
- **工程与测试**：`connection/monitor.rs` 一个回归
  `a_policy_change_deferred_during_connecting_is_consumed_only_by_that_attempt`
  （`#[tokio::test]`：attempt A Connecting 时记录 pending → 按 `disconnect()` 的顺序
  `invalidate_connection` 后断开 → 下一 attempt B 提交时 `take_pending_policy_change(B)`
  为假；B 之后的 attempt C 自己记录的 pending 在其提交时被消费且仅一次）。审查返工前的
  实现断开不清 pending、消费不比代际，"不得到达下个会话"一条会失败（返工前的测试反而
  把"断开后记录仍在"写成了预期，已改正）。兜底条件与代际入口检查未被单测覆盖。
  三个 Windows Cargo workspace 保持分离，仅改 `app`。
- **验证**：本机未运行 cargo 构建/测试/格式检查（2026-09-14 执行位置决定：MacBook 只做
  编辑与源码自查）；委托本 PR 的 GitHub-hosted CI——`windows-2025` 上
  `apps/windows/app/src-tauri` 的 `cargo test --locked` 覆盖上述测试。提交时未获得 CI
  结果，不把未跑的检查写成通过；准确源码 SHA 以 PR 为准。审查返工（pending 清除与
  代际比较、兜底只在"从未尝试发现"时触发、兜底任务带代际）同样本机未编译，委托 CI。
- **候选/发布**：无新包，仅源码；不改 `appcast.xml` / `windows-latest.json`，不推
  `windows-updates`。
- **剩余限制**：只修 connecting 窗口的丢弃/延迟。兜底任务的代际检查与
  `handle_network_change_inner` 再次捕获代际之间仍有一个很小的锁释放窗口（与 policy_sync
  调用方同一纪律）。`directOverlay==='off'` 在其它 Err
  路径被前端渲染为 directOn 的问题仍独立存在（V5 旁注，不在本条范围）；Windows 11
  实机行为未验证，夹具结论不等于设备验收。

## 2026-09-23 · Windows 监视器重连成功后不再自中断丢失连接尾部

- **归属**：G1（已连接=能用；monitor 恢复的会话与用户点 Connect 的会话尾部行为一致）。
  影响 `apps/windows/app` 连接编排与仪表盘。
- **来源**：基线 main
  [576d7087](https://github.com/raydocs/tono/commit/576d7087) → 分支
  `fix/windows-monitor-self-abort-20260922`；
  [差异与关联 PR](https://github.com/raydocs/tono/compare/main...fix/windows-monitor-self-abort-20260922)。
  提交时未合 main。
- **缺陷修复**：R2-F4（对抗核实降级后仍成立）：网络监视器驱动的重连在旧 monitor
  自己的任务栈内联执行，成功尾部 `spawn_network_monitor` 无条件
  `abort_network_monitor()`，abort 了槽位里正在执行 `run_stages` 的自己；tokio 仅标记
  取消，任务在下一个 Pending await（`spawn_control_plane_pin_refresh` 的
  `state.lock().await`，常与托盘刷新任务争锁）被销毁。核实确认的实际损失：本会话
  DIRECT 覆盖层缺失（国内/WeChat 直连回到全隧道，fail-closed 不泄漏）、pin-refresh
  注册丢失（新任务以孤儿存活、靠代际自查，功能不丢）、`seed_autostart_after_connect`
  跳过（仅首连生效，无实质影响）；且 `direct_overlay="off"` 被仪表盘 connectHint 当成
  直连已开显示（旧逻辑只区分 `skipped`）。现在
  `TaskRegistry::register_network_monitor` 比较 `JoinHandle::id()` 与
  `tokio::task::try_id()`，槽位句柄即当前任务时只替换不 abort；旧 monitor 完成连接
  尾部后按既有 `connection_loop_continues(Handled)` 语义自行退出。前端仅
  `directOverlay === 'on'` 显示 directOn，`off`/`skipped` 显示 directSkipped。
- **新增/优化**：无新能力。DIRECT 覆盖层语义、WFP 保护、断开/登出路径的
  `abort_connection_tasks` 全部不变；其余替换路径（用户 Connect、重连退避、节点切换）
  仍中止被替换的监视器。
- **工程与测试**：新增一个回归
  `a_monitor_replacing_its_own_registration_finishes_the_connect_tail`
  （connection/monitor.rs tests）：任务把自身句柄放入槽位后执行同一注册逻辑，
  `yield_now().await` 后 oneshot 发送并断言接收；旧无条件 abort 语义下任务在 yield
  后被取消、收不到 → 失败。
- **验证**：按所有者 2026-09-14 执行位置决定，本机（MacBook）仅编辑与源码自查，
  未运行 cargo/npm 构建与测试；`apps/windows` workspace `cargo test` 与该回归委托
  本 PR CI（GitHub-hosted `windows-2025`），结果续记于 PR。未在 Windows 11 实机复现
  monitor 驱动重连场景。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：实机上的监视器重连后 DIRECT 覆盖层到位情况未验证；UI 提示
  directSkipped 同时覆盖 `off` 与 `skipped`（两者语义一致：国内直连未开）。

## 2026-09-23 · Windows 原生更新接管后不再搁浅 Connecting 状态机

- **归属/来源**：G3 升级生命周期与连接交错（R2 审查 F3，V5 对抗核实已确认）；基线 main
  [576d7087](https://github.com/raydocs/tono/commit/576d7087cc54084acef3a4cda15c433ec96bb679)，
  分支 `fix/windows-update-connecting-fsm-20260922`；
  [差异与关联 PR](https://github.com/raydocs/tono/compare/main...fix/windows-update-connecting-fsm-20260922)。
  提交时仍是独立修复分支，未合 main。选 G3 而非 G1：缺陷不在断开/恢复语义本身，而在原生
  更新事务（Prepare/Install）作废在途连接 attempt 后的收敛缺口；G1 的断开与释放路径未被触碰。
- **缺陷修复**：`tono_install_update` 下载完成后 `inner.invalidate_connection(false)` 使在途
  连接事务以 `Attempt::Stale` 返回（按约定不改 FSM），而后续收敛只折叠 `is_connected`
  （tunnel_died），`resync_after_cancelled_quit` 两侧分支都不命中 connecting——更新失败后
  FSM 永久停留在 Connecting，connect/retry 全拒，仅手动 Disconnect 可解。现把该收敛抽为
  `quiesce_connection_after_update(fsm, core_running)`：connecting 未 armed → 回 Not Connected；
  已 armed → 保留 blocked 闩收敛为 Protected Offline（不放宽保护：更新不是 Disconnect）；
  Connected 行为保持现状（仅 Service 报 Core 已停时 tunnel_died）。审查修正（代际门）：
  收敛原先只要 Service 快照有应答就折叠 connecting，若更新在 `invalidate_connection` 之前
  失败（如下载中途因 WinTUN 改路由断流），会把一个活着的 attempt 强改为 Not Connected，
  进而令其提交时 `InvalidSuccessPrecondition`、已验证连接被丢弃换成受保护重连。现在作废时
  记下 `connect_generation`，仅当它仍等于当前代际（即确是本次更新作废的 attempt）才折叠
  connecting；未作废或代际已被更新后准入的新 attempt 推进时不碰 FSM。遗留 `tono_prepare_update`
  （quit.rs）形状相同但前端与 `generate_handler` 均未引用（死代码），本轮不动，留待专门清理。
- **新增/优化**：无。
- **工程与测试**：app workspace 新增一个窄回归 `update_quiesce_never_strands_connecting`
  （update.rs 测试模块），覆盖未 armed → Not Connected 与已 armed → Protected Offline 两个
  收敛分支，并在同一测试中断言“更新未作废（None）或代际已推进”时进行中的 connecting 不被
  改动（修正前函数无条件折叠 connecting，该断言会失败）；无表驱动套件。代际比较在纯函数内，
  调用点只负责传入作废时与收敛时的代际，调用点本身无测试覆盖。tono-core 无改动（复用既有 `initial_release_failed` /
  `tunnel_died` 转移），三个 Windows workspace 保持分离。
- **验证**：本机（MacBook）按所有者执行位置决定只做源码编辑与 diff 自查，未运行任何
  cargo build/test/check（原生构建禁止本机执行）；编译与回归委托本 PR 的 GitHub-hosted
  `windows-2025` CI（app workspace `cargo test`）。准确源码 SHA 与 CI 结果续记于关联 PR；
  提交时无本机测试结果，不沿用其他 SHA 的绿灯。
- **候选/发布**：仅源码，无新候选包；未触碰 `appcast.xml` / `windows/latest.json` /
  `windows-updates`。
- **剩余限制**：更新在作废前失败时不触碰 FSM（进行中的 attempt 自行完成其转移）。更新收敛依赖 Service 状态快照应答；Service IPC 完全无应答的极端情形仍保持
  本地视图（与取消退出路径的既有设计一致）。该缺陷为已核实的源码推导（R2 + V5），修复前
  未在 Windows 11 实机复现，实机验证仍属 G3 验收范围。

## 2026-09-23 · Windows App 在 Protected Offline（armed 未验证）期间的 Service 真值再同步

- **归属/来源**：G1 断开/保护状态与实际一致（R2-F2）；影响 Windows App
  （`apps/windows/app`，三个 Windows workspace 保持分离）。基线 main
  [576d7087](https://github.com/raydocs/tono/commit/576d7087cc54084acef3a4cda15c433ec96bb679)，
  分支 `fix/windows-service-restart-resync-20260922`
  （[与 main 的差异](https://github.com/raydocs/tono/compare/main...fix/windows-service-restart-resync-20260922)，
  PR 随后在该分支上创建）；提交时未合 main。
- **缺陷修复**：App 存活并显示 Protected Offline（armed 未验证）期间 Service 重启时，
  Service 启动路径 `retire_unverified_windows_kill_switch`（`bin/service.rs` →
  `retire_unverified_on_service_start` → `disarm_unlocked`）会自动删除全部 WFP 过滤器并
  恢复 DNS，而 App 侧核实无任何再同步路径（monitor 仅 `is_connected` 时运行、自动重连需
  `session_verified`、`tono_status` 只回缓存、restore 探测只在启动、IPC 每请求新建管道无
  断线回调），UI 持续显示"已封锁"而机器已明文开放——I3 明文禁止的反向不一致。修复两部分：
  (1) 把 `resync_after_cancelled_quit` 里的 KillSwitchStatus → FSM 折叠抽成
  `apply_service_kill_switch`（`commands/quit.rs`），quit 路径与轮询共用同一语义；
  (2) 新增有界 Service 真值轮询 `protection_resync_loop`（`connection/monitor.rs`，30 s 一次
  读 `/status` 的 kill_switch 聚合），FSM 处于空闲 Protected Offline（armed 未验证为原始
  形态，推广到全部 protection_blocked idle）时经 `TaskRegistry.protection_resync` 注册，
  离开该状态即撤销（registry abort + 循环自退，无常驻线程）；注册点：
  连接失败收敛尾、节点消失/冷切换、启动与重试 restore 尾、释放协调 settled 回调、取消退出
  resync。只在 Service 亲口证明 `wanted=false` 时收敛 FSM 到 Not Connected 并清闩；读不到
  状态保持原状（fail-closed，不放宽保护）；IPC 在途代际变动时不折叠陈旧读数。
- **新增/优化**：无客户可见新功能；仅上述再同步任务与 TaskRegistry 槽位。
- **工程与测试**：新增一个回归
  `protected_offline_converges_when_the_service_proves_the_barrier_gone`
  （`connection/monitor.rs`，`#[tokio::test]`，无 AppHandle 依赖的 spawn 注入）：armed-unverified
  idle 夹具断言 (a) TaskRegistry 持有 protection 轮询句柄——这是新 seam 的存在性测试，
  在 main 上的失败方式是编译失败（`protection_resync` 字段与 `ensure_protection_resync_locked`
  不存在），不是行为失败；它只证明该函数在匹配状态下注册，不覆盖各生产入口是否调用它
  （入口接线靠源码核对）、
  (b) `apply_service_kill_switch(…, Some(wanted=false))` 后 `!kill_switch_armed` 且
  `ui_state == NotConnected`（锁住折叠语义）。W4/W5/W10 已修项（release 所有权、元数据收尾、
  55 s UI 等待）行为不变。
- **验证**：本机（MacBook，编辑机）按 AGENTS.md 执行地点约束未运行任何
  cargo build/test/check/clippy；回归与编译委托本 PR 的 GitHub-hosted `windows-2025`
  CI（app workspace `cargo test`）。源码自查基于逐文件比对，不声称本机已验证。
- **候选/发布**：无新包，仅源码；不涉及 Sparkle/windows 更新源。
- **剩余限制**：登出/关闭路径无需单独挂钩——生产上所有 release（Disconnect、quit/失败转移
  的 `release_explicit`、登出与 restore 的 `release_for_account`）都经 `start_explicit_release`，
  其 settled 回调在监督者更新 FSM 之后、`operation.complete()` 之前注册轮询；唯一直接调用
  `coordinate_release` 的 `commands/account.rs` 位于 `#[cfg(test)]`。但登出 release 被拒时
  FSM 处于 blocked（从而被轮询覆盖）依赖 #295（R2-F1）落地；未合 #295 时未 arm 竞争分支
  FSM 为 Not Connected，是 F1 本身而非本条。已验证会话经 monitor `tunnel_died` →
  `schedule_reconnect_for_generation` 进入 idle Protected Offline 且未排程重连（如重连预算
  耗尽）时不注册轮询；已验证 intent 在 Service 重启时保留、不被 retire，不构成 I3 反向。
  实机"Service 重启 + 存活 App"组合夹具仍缺
  （known-findings §6），本轮以源码级路径与单测覆盖。

## 2026-09-22 · Windows 拒绝释放后的连接 FSM 保护可见性

- **归属/来源**：G1 断开与恢复——断开后保护状态必须两端一致；本条修的是 Service
  拒绝 release 时 App FSM 谎报 Not Connected、Disconnect 随之变成空操作的断开一致性
  缺陷。基线 main [576d7087](https://github.com/raydocs/tono/commit/576d7087cc54084acef3a4cda15c433ec96bb679)
  → 分支 `fix/windows-release-refused-fsm-20260922`（PR 见关联分支）；提交时未合 main。
- **缺陷修复**：R2-F1（2026-09-22 并发/时序审查 + 对抗核实轮已确认）。Disconnect/登出
  与 in-flight StartClash 竞争且 Service 拒绝 release 时，release 监督者只调
  `initial_release_failed()`，而该方法把 `is_protection_blocked` 折叠成本次 attempt 的
  本地 `kill_switch_armed` 闩——该闩被 StartClash 竞争跳过、从未置位，FSM 于是报
  Not Connected，WFP 实际仍 Blocked；此后 `disconnect()` 命中 idle 早退成空操作，托盘
  禁用 Disconnect。现在监督者 Err 分支先 `mark_kill_switch_armed()` 再
  `initial_release_failed()`（拒绝本身即事实，fail-closed 假定保护仍在，与错误文案
  "protection stays on" 一致）；`tono_sign_out` 的 release 失败早退分支同样置闩，与既有
  Expired 收尾分支对齐。不放宽保护：WFP 删除逻辑、Service 侧、fail-closed 语义均未改。
- **新增/优化**：无。
- **工程与测试**：新增一个窄回归
  `refused_release_after_an_unarmed_connect_race_keeps_protection_visible`
  （`apps/windows/app/src-tauri/src/tono/connection/disconnect.rs` tests）。旧实现上该测试
  必失败：夹具 `begin_connect`+`begin_disconnect`（闩未置位）加注入 Err 的 release，
  旧 `initial_release_failed` 得 `is_protection_blocked=false`，末条断言不成立。
- **验证**：本机未编译未运行（编辑机约束，见 [BUILD_AND_TEST](BUILD_AND_TEST.md)）；
  回归委托本 PR 的 GitHub-hosted CI（`windows-2025`，`app-rust` job 在
  `apps/windows/app/src-tauri` 跑 `cargo test --locked`，路径过滤命中 `apps/windows/app/**`）。
  准确源码 SHA 为本 PR 实际 push 的 commit（PR head）；提交时 CI 结果未产出，以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：只修 FSM 闩推断，不改变 Service 拒绝 release 的根因（DNS restore 失败、
  core 终止未确认、WFP 过滤器删除失败仍会拒绝并保持 armed）；Windows 11 实机断开/恢复
  清单未重测，不据此关 G1。监督者 Err 分支不区分 Err 来源、不读 Service 真值：Err≠拒绝
  的子情形（Service 不可达/修复被拒、更新栅栏、release 任务 join 失败）同样置闩，若此时
  机器从未 arm（Disconnect 落在 StartClash 之前），会被显示为 Protected Offline 而实际开放；
  这与 `restore.rs` 对 `Unknown` 的既有取舍（记作 armed、不 verified）一致，由 #299 的
  Service 真值轮询在 Service 可达后约 30 s 内以 `wanted=false` 纠正（未合 #299 时无自愈）。

## 2026-09-23 · Windows 混合 DNS 残留不能证明恢复成功

- **归属/来源**：G1 断开与恢复；从已合入的
  [4d4aafc8](https://github.com/raydocs/tono/commit/4d4aafc8129988cee76150ddb7ebdf0becd7d4b2)
  继续定点检查，分支 `fix/dns-followup-20260923`；
  [差异与关联 PR](https://github.com/raydocs/tono/compare/main...fix/dns-followup-20260923)。
  本条提交时仍是独立修复分支，不沿用上一轮 main 合并授权。
- **缺陷修复**：恢复快照损坏、进程内没有旧失败标记时，IPv4 `NameServer` 或
  `ProfileNameServer` 中的 `1.1.1.1, 198.18.0.2` 被“列表全是 Tono 地址”的判断漏掉，
  `recover_unreadable_snapshot` 可错误接受恢复并隔离唯一快照；卸载恢复也会漏选这个适配器。
  现在复用已有“包含当前 TUN DNS 地址”的判断：仍有该地址就保留快照并拒绝恢复成功，
  不把公共备用 DNS 当成移除残留的证据。旧 loopback/用户本地解析器处理保持不变。
- **工程与测试**：新增一个生产 facade 回归
  `mixed_protected_dns_cannot_prove_corrupt_snapshot_recovery`，经过真实损坏文件解析、
  原生 engine 的注册表读取、恢复拒绝和卸载选择；清除残留后还须能完成恢复并保留隔离文件。
  延用 OS I/O 隔离夹具，补入 NRPT/DoH 恢复计数，避免反例和正例触碰宿主策略；没有伪造
  facade 的成功/失败结果。既有 native DNS 前缀已覆盖新测试，无工作流改动。
- **验证**：本地只做 diff/格式检查；原生命令由现有 GitHub-hosted `windows-2025` Service
  执行：`cargo test --locked --features standalone,client --lib core::dns::engine::native_apply::tests:: -- --nocapture`，
  前置相同前缀的 `-- --list` 防止零测试。准确源码 SHA、实际结果及日志续记保留在关联 PR；
  提交时未获得本次原生结果，不把上一轮 main 的绿灯移用到此修复，也没有修复前的原生红灯。
- **新增/发布/限制**：无新功能、无新包、无部署；只收紧残留 DNS 的恢复证据，不变更
  WFP、恢复超时、原始 DNS 字符串或快照 schema。夹具验证不等于 Windows 11 实机恢复、
  真实 API/适配器变化或 G1/G3 验收；本轮定点检查不表示整个产品已无 bug。

## 2026-09-23 · 桌面源码合入 main，保留发布边界

所有者在本线程明确要求把能合并的 PR ship 到 GitHub `main`。归属仍为 G1–G3
桌面整改、升级与可追溯验收；本轮是源码集成交付，不是新的功能实现或客户发布。

- **已合入**：[#289](https://github.com/raydocs/tono/pull/289) 正常合并为
  [1ca878cf](https://github.com/raydocs/tono/commit/1ca878cfb8f9c213356eae263a83e5eba0b39075)，
  一次保留 #281 → #282 → #283 → #286 → #289 的完整提交历史和最终修复。
  合并前 main 为 [569ce865](https://github.com/raydocs/tono/commit/569ce8654f57e66f293cf4e443b5e0819b71912d)；
  `git diff --exit-code d954a7f740f95f141136af423a39338d79a1b674 origin/main` 返回 0，
  合并结果与已验证最终组合源码的完整树相同，没有把有已知续修的中间版本逐次送入 main。
- **说明已合入**：[#280](https://github.com/raydocs/tono/pull/280) 正常合并为
  [e94161e0](https://github.com/raydocs/tono/commit/e94161e07593d581995b4a9eecc54030eeaa7118)。
  相对上一项仅增加两端 release notes 和既有 RC 报告，不改变候选字节。
- **重复 PR 收尾**：GitHub 已把 #281 标记为 merged；#282/#283/#286 的准确 head
  已是 main 的祖先，作为已集成记录关闭。#277/#278/#284/#285/#287/#288/#290 经
  `git cherry` 确认所有提交均有等价补丁，再按 #279/#289 的组合交付关闭。
  这不是丢弃源码，也不把子分支曾有的编译/测试失败改写成通过；没有重复合入旧实现。
- **依赖组合另验**：三个原有绿灯 PR [#252](https://github.com/raydocs/tono/pull/252)、
  [#255](https://github.com/raydocs/tono/pull/255)、[#256](https://github.com/raydocs/tono/pull/256)
  在新 main 上无冲突合成 [#292](https://github.com/raydocs/tono/pull/292)，准确源码
  [94bfa6cf](https://github.com/raydocs/tono/commit/94bfa6cfa15e13bba9786ec103be49a996010d4c)。
  只含 Rollup、Windows 前端依赖组与 Rust 锁文件这七个文件；新 updater 的依赖条目保留。
  `git diff --check origin/main...HEAD` 返回 0；记录时组合 Windows CI 待完成，仍为 Draft，
  尚未合入。8 分钟有界等待结束时 18 项成功、2 项 Windows app-rust 待完成，详见
  [当时状态及续验入口](https://github.com/raydocs/tono/pull/292#issuecomment-5787253794)。
  已完成的准确 push 日志确认：
  [前端](https://github.com/raydocs/tono/actions/runs/35804404717/job/107001851595) 36 文件/282 测试通过；
  [Service](https://github.com/raydocs/tono/actions/runs/35804404717/job/107001851691) 310 项 lifecycle、
  6 项 DNS、4+3+1 项更新及 WFP 形状检查通过。旧依赖 PR 的绿灯不代替新组合证据。
- **未强行合入**：[#253](https://github.com/raydocs/tono/pull/253) 的 control-plane/
  ops-contract/migrations 失败；[#254](https://github.com/raydocs/tono/pull/254) 的
  ops-contract 与四个 E2E shard 失败；[#203](https://github.com/raydocs/tono/pull/203)、
  [#204](https://github.com/raydocs/tono/pull/204) 有冲突且保留未完成的产品范围。
  [#275](https://github.com/raydocs/tono/pull/275) 仍是固定旧二进制的单次诊断 Draft，
  其红/绿诊断已用于 #276 修复，不把过时的例外工具作为新主线功能合入。
- **验证与限制**：合并前复核 #289 的 12 项检查全成功，原始命令、确切 CI checkout、
  377 项 macOS（1 skip）及 Windows DNS 6 项/lifecycle 310 项等证据见下文 F。
  合入 main 后 [Services CI](https://github.com/raydocs/tono/actions/runs/35804170997) 成功；
  [macOS CI](https://github.com/raydocs/tono/actions/runs/35804298002) 的实际 checkout 为上述
  e94161e0，仍是 377 项、1 skip、0 失败；旧 1ca878cf 的 macOS run 被后续 push 的既有
  concurrency 规则取消，不计通过。[Windows Service](https://github.com/raydocs/tono/actions/runs/35804170998/job/107001095427)
  实际 checkout 为上述 1ca878cf，310 项 lifecycle、6 项 DNS 及更新/WFP 检查通过；当时
  app-rust 仍在跑，不声称整个 main workflow 全绿。命名结果来自完整 job 日志，非步骤名推断。
  未手动 dispatch、重跑或取消 CI，也未创建后台监控或自动合并承诺。
  本记录的文档整理不另跑产品测试。没有 force push、历史改写、分支删除或工作树清理。
- **候选/发布：源码交付，未发布新候选。** 已发布 RC 仍固定在旧的 569ce865，仍不含下文 C–F；
  常规 CI 产生的未签名构建不是已签名 RC，不替换旧下载包。未部署 Worker、签名、安装设备、推进 Sparkle/windows
  更新源，#26 及原有 G1/G3 实机、PF/WFP/DNS 与性能证据要求不因合并关闭。

### 2026-09-23 续记 · 剩余依赖检查完成并合入

整理交付记录期间的最终复核发现两个 app-rust 已完成；[#292 的完成续记](https://github.com/raydocs/tono/pull/292#issuecomment-5787272136)
保留了这个状态变化，没有删除上面的 pending 观察。准确组合源码的 **20/20 检查全部成功**，
包括 [Windows push 原生消费者](https://github.com/raydocs/tono/actions/runs/35804404717/job/107001851447)：
499 项 Tauri、18 项 journal、3 项 atomic、1 项共享合同通过；另一个原有 opt-in target 的
1 项 ignored 不计为执行成功。CI 日志提取摘要可用但命名列表有截断，不充作全需求证明。

[#292](https://github.com/raydocs/tono/pull/292) 随后正常合入 main 为
[4f58da37](https://github.com/raydocs/tono/commit/4f58da37fffa15bf5dc4430d6afb413af6e9561c)。
合并后的完整树与已测试的 [94bfa6cf](https://github.com/raydocs/tono/commit/94bfa6cfa15e13bba9786ec103be49a996010d4c)
相同；GitHub 同时确认 #252/#255/#256 均为 merged。没有另行解决依赖代码冲突、变更锁文件
之外的实现或放宽测试。此前桌面合并的 Windows run 35804170998 此时也已全部成功。

本总账及维护规则通过 [#291](https://github.com/raydocs/tono/pull/291) 的文档变更收尾。
最后的新 main push CI 是独立运行，不把上述合并前或前一 main 的通过数重标为该 run 的结果。
保留未合入项仍为 #253/#254 的失败检查、#203/#204 的冲突/未完成范围和 #275 的旧诊断 Draft。
已合入源码与既有 RC 的包含关系仍不同，发布及实机门不变。

## 2026-09-21—23 · 工程整改线程全程回填

来源：[Tono 工程整改验收线程](https://ampcode.com/threads/T-01a0c5d0-1c0d-77a0-b272-0a931282c5b5)。
本条按已交付提交、PR、分项报告和候选来源回填，不把线程启动前已存在的修复重新算作发现。
例如 #240/#242/#244/#258/#262 及其子 PR 的代码被纳入基线/后续合并，但不是本条新发现的 20 项。
首轮报告明确编号 **20 项（W1–W14、M1–M4、S1–S2）**；下文另列后续修复与功能，
不把它们混成一个无法复核的「全部 bug 总数」。

### 交付与包含关系（2026-09-23 合入授权前的历史快照）

以下保留首次回填时的状态，不覆盖当时的未合入/未验证事实；后续合入状态以上方续记为准。

| 批次 / 归属 | 源码与 PR | 当前交付状态 |
|---|---|---|
| 首轮工程整改 / G1–G3、ops | [#267](https://github.com/raydocs/tono/pull/267)，合并 [0e20f2df](https://github.com/raydocs/tono/commit/0e20f2df671a528d80c2366d65aca3df1830117a)；含 #268/#271/#272 | 已合 main；20 项源码整改和组合证据见 A。 |
| 候选安装与构建 / G3 | [#276](https://github.com/raydocs/tono/pull/276)，实现 [429d6e40](https://github.com/raydocs/tono/commit/429d6e40ea775d0fb38d0e84053a4e44943c015e) | 已合 main；含 B 的安装路径和候选配置修复。 |
| 两端易用性 / G1–G3 | [#279](https://github.com/raydocs/tono/pull/279)，合并 [569ce865](https://github.com/raydocs/tono/commit/569ce8654f57e66f293cf4e443b5e0819b71912d)；含 #277/#278 | 已合 main；也是当前已发布 RC 的冻结源码。 |
| 测试包及说明 / G1/G3 | [#280](https://github.com/raydocs/tono/pull/280)，文档 [3d57e59c](https://github.com/raydocs/tono/commit/3d57e59ccb7cb4b4248f32733ecafeb89a51b800) | RC 已发布；说明 PR 尚未合并。不能把说明提交当包源码。 |
| #251 续修 / G1/G3 | [#281](https://github.com/raydocs/tono/pull/281)，[ac2cde16](https://github.com/raydocs/tono/commit/ac2cde16a5e303a09e0bc8893f02972b34671115) | 已推送、未合 main；C。 |
| 共用升级合同 / G3 | [#282](https://github.com/raydocs/tono/pull/282)，[e811d740](https://github.com/raydocs/tono/commit/e811d740bfc733f65b54bf6ea4223d4f250482c8) | 已推送、未合 main；仅该批是未接入的值模型，不单独声称原生升级完成。 |
| 原生升级接入 / G3 | [#283](https://github.com/raydocs/tono/pull/283)，[aeb4b5ad](https://github.com/raydocs/tono/commit/aeb4b5ad69330507fdeed70a4b263667b2619eda)；含 #284/#285 | 已组合、未合 main；D。受保护装机验收仍开放。 |
| 连接优化 / G1/G2 | [#286](https://github.com/raydocs/tono/pull/286)，[705e16d9](https://github.com/raydocs/tono/commit/705e16d9ac80a800591da195c0c360029db0ff77)；含 #287/#288 | 已组合、未合 main；E。没有设备提速百分比证据。 |
| DNS 反例续修 / G1 | [#289](https://github.com/raydocs/tono/pull/289)，[d954a7f7](https://github.com/raydocs/tono/commit/d954a7f740f95f141136af423a39338d79a1b674)；含 #290 的测试与修复 | 已组合、ready for review、12/12 CI 检查成功，未合 main；F。 |

未合并源码的依赖链为 **#281 → #282 → #283 → #286 → #289**；子 PR 已实际集成，
不是只引用提交号，也不应重复计算/重复应用。当前远端 main 与 RC 都仍是 569ce865，
**已发布 RC 不包含 #281 及其后的 picker、原生升级、连接优化和 DNS 续修**。

### A. 首轮确认并修复的 20 项

原始归属、反例、命名测试、红/绿结果与未覆盖模块见
[组合整改记录](reports/ENGINEERING_ACCEPTANCE_2026-09-21.md)、
[macOS 分项](reports/ENGINEERING_MACOS_2026-09-21.md)和
[服务端分项](reports/ENGINEERING_SERVICES_2026-09-21.md)。以下保留原编号，便于逐项回查。

| 编号 | 确认的失败场景 → 修复结果 |
|---|---|
| W1 / #247 | 重试槽位覆盖后旧任务失去句柄仍运行 → 替换前取消旧 loop，任务归属和代际一起提交。 |
| W2 / #249 | 卸载时 NRPT 恢复失败被适配器 fallback 吞掉 → 不报告恢复成功，保留快照和重试责任。 |
| W3 / #251 | 节点页/托盘用旧 idle 状态，在后端热切换后追加 Connect → 选择确认后读回后端状态；残余 admission 竞态见 C。 |
| W4 / #248 | 退出登录尚未结束，调用者消失后又允许连接 → 账户关闭责任持续到真实清理结束。 |
| W5 / #246 | 断开 UI 等待者取消，会话计时/重试元数据未清理 → 释放所有者继续完成收尾。 |
| W6 | 旧验证迟到后覆盖新连接的 controller secret/port → 发布边界核对原连接代际。 |
| W7 | 旧 logout 响应迟到，撤销或删除替换账户的凭据 → logout 绑定发起时账户。 |
| W8 / #259 | DNS 自写窗口直接丢弃真实网络变化 → 保留待处理事件，窗口后比较物理拓扑再协调。 |
| W9 | 下一次重试清空 live error，旧失败原因丢失 → 按原 attempt 保留有界、脱敏的原因及阶段。 |
| W10 | 55 秒 UI 超时被当成真正释放结束，过早重开登录 → owner 等实际释放，UI 等待预算不改变责任。 |
| W11 | restore 401 的代际检查后账户已替换，旧清理误伤新账户 → 首个副作用前原子预约账户关闭。 |
| W12 | vault 写/删乱序，旧写复活令牌或旧删抹掉新令牌 → 单写者 FIFO，退出等待持久化删除确认，错误不装作已退出。 |
| W13 | A 的 JSON 请求遇 401，借 B 的凭据重放 A 内容 → 请求与重试都绑定原账户身份。 |
| W14 | A 的失败在等待 Service status 后才取身份，首次上传已归给 B → 连接 admission 捕获不可变账户身份，贯穿失败记录和上报。 |
| M1 | macOS AppState 拒绝释放后，AccountSession 第二个 owner 仍恢复 DNS/解除 PF → AppState 成为唯一释放所有者。 |
| M2 | DNS 读取失败被当成空配置，删除恢复快照并允许释放 → 保留读错与快照，拒绝假恢复，允许重试。 |
| M3 | audit 写盘失败不断回填整批，重试缓冲无界增长 → 限制为最近 256 条/256 KiB，恢复后记录本地丢失情况。 |
| M4 | 更新日记把旧 Mihomo 版本/build number 当运行 Core/源码，丢失已知 catalog revision → 不可得身份保持 unknown，保留实际已知 revision。 |
| S1 / #269 | 密码脱敏只替换标签，值仍进入 collector/Worker 结果 → 上传和存储边界移除值，保留非敏感故障上下文。反例使用合成凭据，不声称发生真实泄漏。 |
| S2 / #270 | SSH rc255、journal rc1 被当作成功观测 → 非零读取报错，不能产生「无故障」证明；成功空输出仍合法。 |

工程配套：collector 的路径触发和 25 项测试补入 Services CI；权限阻塞解除后才实际推送并
执行成功。纯边界提取、测试 seam、预算内模块拆分不另算产品 bug。
首轮组合及 merge 后证据包括 Windows App 492 项、macOS 344 项（1 既有 skip）、Worker
890 项和 collector 25 项；准确命令、不同 checkout 与范围均在原始记录，不冒充最新全部源码结果。

### B. 安装、候选与易用性阶段的后续修复

| 范围 | 已修复内容 | 记录 |
|---|---|---|
| Windows 覆盖安装 | `C:Users` 是随工作目录变化的盘符相对路径，导致合法候选修复失败；改为合法 SystemDrive 下的绝对 Users 路径，保留枚举/日记拒绝。 | [候选修复与原始安装 smoke](reports/CANDIDATE_INSTALL_FIXES_2026-09-22.md)，#276。 |
| macOS 候选配置 | 签名候选仍只接纳 0.0.72；收敛到精确 0.0.73 专用分支/产物合同，并移除同一 run 重复生产同名 Core artifact 的冲突，不放宽到任意 PR。 | 同上；签名实际执行另见 RC 记录。 |
| Windows Activity | 把只有 selector 的链当作已观测出口 → 仅已报告的 terminal 作为线路证据，未知不猜测；正对照保留 DIRECT/家宽/云端。 | [易用性组合记录](reports/DESKTOP_USABILITY_0_0_73_2026-09-22.md)，R1，#279。 |
| macOS 近期成功 | 验证期间同名目录被替换，将旧 digest 的成功记给新目录 → connect/switch 提前捕获 digest，完成时不相同就不记成功。 | 同上 R2，具备 hosted red/green。 |
| 易用性实现中的整合错误 | 修正 Windows 旧上传调用、账户替换后残留预览/回执、收藏按钮归属、缓存摘要被误读为实时健康；保留冻结预览、明确同意和未知状态。 | 同上；这是本线程新能力整合时纠正的问题，不全是旧版本缺陷。 |
| 发布说明 | macOS 14+/helper 4.3.0 与实际包不符 → 说明 Apple Silicon、macOS 26.3+、helper 4.4.0；Windows 标 x64；去掉稳定版/首次公开发行误标。 | [已发布 RC 的后续记录](https://github.com/raydocs/tono/blob/3d57e59ccb7cb4b4248f32733ecafeb89a51b800/docs/reports/DESKTOP_USABILITY_0_0_73_2026-09-22.md)，#280；未改变兼容性目标或包字节。 |

同时交付的 **六项新增能力，不计为六个 bug**：本地只读健康检查；报告冻结预览/同意/回执；
版本与运行身份说明；按账户的收藏/近期成功/固定地区/推荐；恢复进度反馈；应用线路解释。
最终该阶段 Windows App 499 项、macOS 356 项（1 既有 skip）通过；Windows 浏览器和 macOS
生产组件图已检查。完整原生窗口、真实上传、真实网络与所有交互不由这些截图证明。

### C. #251 剩余时序与更新日记覆盖

[#281](https://github.com/raydocs/tono/pull/281) 处理状态读回与 Connect admission 之间的竞态：
另一窗口已赢得连接，本窗口收到重复/过时代际拒绝后，节点页误报失败、托盘不刷新/不关闭。
改为只协调已识别的 **Connect** 竞争拒绝，仍刷新真实后端状态；Select/status 错误不吞，
不重试 Connect，也不发明 Connected。21 项页面/托盘回归通过，旧实现 2 项按预期失败。

同批扩展更新日记的逐相位写盘失败/旧文件保留回归，并把依赖包日记 unit tests 真正接入
Windows lane、加非零枚举门；以前 App 的 cargo test 不会自动跑依赖的 unit tests。
这项测试覆盖不等于实现了受信任安装交接。
详见[该准确源码的闭环记录](https://github.com/raydocs/tono/blob/ac2cde16a5e303a09e0bc8893f02972b34671115/docs/reports/WINDOWS_251_G3_CLOSEOUT_2026-09-22.md)。

### D. 共用升级协议及原生接入

这是 #282/#283 的 **新增与结构性实现**，不是把整个协议计为一个已经发布的 bug 修复：

- 两端共用 canonical manifest、同源码成对包、签名 releaseSequence；校验独立签名与实际包摘要。
- macOS 的 root Helper 与独立 launchd 执行器持有完整包更新；Windows 的 Service 与独立
  SYSTEM 执行器持有准入和替换。App 日记、同版本字符串或同路径不再充当安装授权。
- 私有暂存、先持久化消费再替换、丢确认的单次消费、真实 successor 身份、回滚及高水位保留；
  明确 Disconnect 不伪造恢复/提交，也不删除已消费或不确定事务。
- 配套成对构建/离线验证、精确只读下载路由与原生测试 lane；没有部署路由或发布 v1 更新对象。

实现中另纠正了：macOS 重读账本时的持久化确认、未消费事务先归档再退休、合法临时包路径
序列化；Windows 恢复任务早于持久化消费注册、未消费事务退休边界；更新拒绝在模态框外看不见、
关闭重开后还能重试同一拒绝 manifest；不完整更新提示与进度卡重叠。失败证据与保护未放宽。

编译 API/PID 绑定、sha2 版本调用、测试临时目录冲突、截图缩放/透明度、缺失 OK 翻译及旧包装
变异断言也已修正，分别保留失败来源；它们不都等于独立生产运行时漏洞。
证据见 [#283 的组合日志](https://github.com/raydocs/tono/pull/283)、
[原生接入合同](https://github.com/raydocs/tono/blob/aeb4b5ad69330507fdeed70a4b263667b2619eda/docs/UPDATE_INTEGRATION_V1.md)：
macOS Helper 更新自测 7 项、XCTest 361 项（1 既有 skip）；Windows Store/native/executor
4+3+1 项通过。具体 OS/签名成功效果有注入，不是实际受保护安装/断电/重启验收；#26 仍开放。

### E. 连接速度与取消责任

- macOS 原阻塞 resolver 会使 task-group timeout 仍等待子任务；改用 DNS-SD 后，独立审查
  又确认其同步提交也会卡住同队列 deadline/cancel。最终独立 waiter 先启动 timer，取消/截止
  立即结束调用者等待，C ref 仍在原串行队列清理；旧调用未清理前拒绝堆叠第二次提交。
  **没有强制取消同步 C 调用**，这是明确保留的边界。
- 最后一轮 mixed diagnostic 与 TUN 探测并行；TUN 成功不等诊断，迟到/取消的结果不能改
  新连接的 preferred origin 或遥测。诊断成功不能替代真实 TUN 成功。
- Windows 原生 IP Helper 应用 DNS 并读回有效 IPv4/IPv6，健康路径不启动 shell；已完成的
  错误才用一次兼容批次并全量重读。保留原始 DNS、restore 与超时后单写者，非设备性能证明。
- 新增只读同设备/同线路 P50/P95 比较工具，保留失败/取消/丢失尝试；纠正实现期间发现的
  Mac stage 名、缺少 Windows 单调计时和显示四舍五入越过 30% 阈值的问题。9 项测试使用
  合成时长，不能算实际提速。

证据：[连接 beta 记录](https://github.com/raydocs/tono/blob/705e16d9ac80a800591da195c0c360029db0ff77/docs/CONNECTION_BETA_2026-09-22.md)、
[#286 的组合结果](https://github.com/raydocs/tono/pull/286)：macOS 372 项（1 既有 skip），
包括 6 个系统 DNS 与 5 个连接时序测试；Windows 原生 DNS 4 项通过。
DNS-SD 同步提交的修复前问题是源码确认，没有把未执行的 native red 记成通过；最终 held-call
回归已执行。补齐的 Swift 显式源码列表与原生测试枚举是工程修正，不是额外连接缺陷。

### F. 最近一次发现并修复的四组 DNS 问题

| 范围 | 失败场景 → 修复结果 |
|---|---|
| macOS listener 取消 | NWConnection 构造期间取消，尚未登记连接而丢失取消 → 独立终态立即结束等待，真实 Disconnect 不必等 DNS 超时。 |
| macOS listener 响应证明 | 无关问题/owner、错误/截断应答、后续畸形 RR 仍留下 fake-IP；复审发现 OPT 扩展错误也被忽略 → 匹配实际随机 ID、IN A 问题和 owner/CNAME，完整校验帧，并拒绝未协商的 OPT。 |
| Windows 适配器消失 | 消失被报 apply 成功，清掉未验证标记 → 消失不给正面结果，返回后仍须实际 setter/readback；不反复重写健康适配器。 |
| Windows 部分写失败 | IPv4 已写、IPv6 失败，还没有 pending 标记，下一次被「看起来已配置」跳过 → 活跃适配器写前保存义务，错误/超时不退休，watchdog/idempotence 看活跃 pending。 |

[#289](https://github.com/raydocs/tono/pull/289) 保留 listener、OPT、Windows 两项的真实红/绿结果，
并已集成 #290 两个提交。最终源码是 d954a7f7，不是只拿子分支 green 代替组合：

- [Windows Service job](https://github.com/raydocs/tono/actions/runs/35800295759/job/106988865192)
  实际 checkout 为 d954a7f7；`cargo test --locked --features standalone,client --lib
  core::dns::engine::native_apply::tests:: -- --nocapture`：6 passed / 0 failed，另有 310 项 lifecycle。
- [macOS XCTest job](https://github.com/raydocs/tono/actions/runs/35800298994/job/106989255243)
  实际 checkout 为 PR merge [63a98602](https://github.com/raydocs/tono/commit/63a986027d50948438bc5daad33f3f95f85abf80)，
  与 d954a7f7 的完整 tree 相同；现有无签名 `xcodebuild ... test`：377 项、1 既有 skip、0 失败，
  五项 listener 测试均通过。完整命令、精确来源及红/绿链接在 PR。
- 2026-09-23 复核 #289 的 12 项 CI 全部成功。限定独立复审没有剩余确认的范围内源码缺陷，
  不是「所有 bug 已找完」。原始 DNS、restore/NRPT/DoH、PF/WFP、App 真流量证明保持。

### 已发布 RC 与最新源码不能混用

[RC 2026-09-22.1](https://github.com/raydocs/tono/releases/tag/tono-desktop-0.0.73-rc.20260922.1)
为 `draft=false, prerelease=true`；标签实读指向 569ce865。详细签名、安装和下载证据见
[#280](https://github.com/raydocs/tono/pull/280)。这是此前明确授权后的历史交付，本次整理没有重发。

| 实际包 | SHA-256 | 已有资格及限制 |
|---|---|---|
| `Tono-0.0.73-build73-arm64.zip` | `fb4dc0f68987da54705b20c386426d631cb3a2659740d87965ff672f5332393f` | Developer ID/公证/Gatekeeper 通过；Apple Silicon、macOS 26.3+；非 Sparkle 客户发布或最新 v1 实机验收。 |
| `Tono_0.0.73_x64-setup.exe` | `e0837a2ab2f5126ae05f11188f9a7de469605453785888310cafb7f566ed0cad` | 原始 hosted fresh install/同版本 repair/uninstall/DNS 不变通过；无 Authenticode/updater 签名，`physicalUpgradeQualified=false`。 |

两包同源，包含 A/B 已合并产品修复和六项能力；不包含 C–F 后续源码。
本总账不创建新候选、不更新旧资产、不改客户源；不能把前一轮「未签名/未合并」的报告时点
套到整个线程，也不能把这一个旧 RC 的签名/安装证据套到最新源码。

### 查过什么，以及尚未查完什么

已重点检查：Windows 连接/切换/取消/重试/账户/凭据/失败上报、Service DNS/NRPT/WFP/网络事件、
两端安装更新；macOS AppState/协调器/helper/PF/DNS/audit；Worker 身份/目录/策略/诊断边界；
exit/home-agent、collector；相关 ops 证据、构建/测试/发布来源。深度和方法不同，详细覆盖矩阵
见 A 的三份报告；不是所有目录逐行审计、全 parser fuzz 或全并发状态空间穷举。

仍保留：

- [#26](https://github.com/raydocs/tono/issues/26) 的最新 v1 在已安装 macOS/Windows 11 上成功/失败
  更新、实际 successor/PF/WFP/DNS、重启与中断恢复证据。协议源码已接入，不代表此项已关闭。
- [#241](https://github.com/raydocs/tono/issues/241)、[#249](https://github.com/raydocs/tono/issues/249)、
  [#259](https://github.com/raydocs/tono/issues/259) 的设备/系统边界；[#251](https://github.com/raydocs/tono/issues/251)
  的后续代码仍待合并。Issue 开放不意味着表中已修代码不存在，也不该只凭代码关闭实机项。
- [#273](https://github.com/raydocs/tono/issues/273) 已有旧 RC 的签名执行证据，不能写成从未签名；
  但最新分支的新包/已安装 helper 资格仍未由旧 RC 建立。
- 真实线路 UUID/握手、运行中组件/配置身份、睡眠/Wi-Fi/IPv6/适配器变化、包级防漏、真实凭据库
  与报告回执；没有把 EOF 推断成特定网络原因，也没有实测 30–50% 提速。
- ops [#4](https://github.com/raydocs/tono/issues/4)、[#5](https://github.com/raydocs/tono/issues/5) 的计量
  边界/重置代际未解决；没有生产切换。一般 ops UI/digest freshness、未交付 Linux/CLI/移动端、
  无关第一方文件和第三方内部并未全部审计。

本次文档交付仅建立总账与以后同 PR 留记录的规则，归属 G1–G3 可追溯验收及已有 ops 证据。
历史检查均沿用其原 SHA/日志；不为整理文字重跑产品测试，不作新的合并、签名、部署或发布。
