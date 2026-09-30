## 2026-09-29 · Windows：意外重启后不再自己重连；卸载中止时交还租约；NRPT 规则删不掉时卸载停下
- 归属：SHIP_PLAN G1（Windows 可恢复性），§2 第 10 条冻结期修复。影响 Windows Service（`core/boot_session.rs` 新增、
  `core/desired.rs`、`core/dns/mod.rs`、`core/dns/engine.rs`、`core/windows_kill_switch.rs`、`core/update.rs`、
  `update_transaction.rs`、`update_wire.rs`、`bin/service.rs`、`bin/uninstall_service.rs`、`bin/shared/mod.rs`）、
  App（`tono/commands/update.rs`、`tono/commands/restore.rs`）与 NSIS（`installer.nsi`）。发现 BRICK-W1、BRICK-W2（NSIS 半边）、
  BRICK-W4；另记 open 分片 BRICK-W3、BRICK-W6–W9。
- 来源：基线 origin/main `c0e7758e`；分支 `fix/win-boot-uninstall-20260929`；红提交（仅测试与骨架）`4c8c1444`、`bbe68304`、`7ec62f49`，
  修复提交 `f93212ec` 与编译修正 `82d0a598`，本记录提交在其后；PR [#680](https://github.com/raydocs/tono/pull/680)，未合 main。方向：PLAN-win-boot-uninstall 第 3 版（Jev 533a3cfc，
  计划评审 5ad5a75b → 5d381aec → 38c453fa 通过），实现决定 9b3d278d。
- 缺陷修复：
  - BRICK-W1（Service）：崩溃、蓝屏或断电后，Service 在任何人登录前就按上次的运行意图启动 Core。改后运行意图记下写它的
    那次开机（`HKLM\SYSTEM\CurrentControlSet\Services\TonoService\BootSession` 易失子键的 `Id`，从不创建 Service 键本身，
    每进程只算一次），Service 启动只在两个标记都在且相等、并且已恢复出 wanted 屏障时才重放；否则记一条 warn、返回、不改写意图。
    WFP 仍按自己的意图恢复（Locked 降为 Blocked），用户点 Connect 或 Retry 再连。wanted 屏障条件也挡住紧急解除之后同一次开机
    的 Service 重启重放一个没有屏障的 Core（5d381aec/codex:F1 要的门）。
  - BRICK-W1（App 更新恢复）：原生更新替换后被重启打断时，此后每次登录的 App 都是后来的进程，却每次都自己 Connect 去完成更新。
    改后 Service 在 Adopt 回答 `successor_relaunched`（不是执行器记录的那个进程就为真，在认证可能改绑之前算；老 Service
    不带此字段读作 false），App 用进程内状态 `Adoption { Undecided, Allowed, Held }`：只有确定的 false 能开，失败、不确定或
    重新启动都进入 Held，且 Held 在本进程内不再变（堵住「改绑已存盘、答案丢失、同进程重试读到 false」的缺口）。
    Restore internet（更新 Disconnect）与用户自己的 Connect 不受影响，Connect 仍会完成更新。
  - BRICK-W2（NSIS 半边）：卸载程序在「Tono 正在运行」处取消或结束失败、卸载助手缺失或清理未证实而中止时，手动租约一直留着，
    Service 随后拒绝释放、更新 Disconnect 与修复，直到另一个安装程序运行。改后 `$TonoManualMutated` 挪到 `RemoveVergeService`
    之前；新函数 `un.HandBackManualLease`（保存 `$0`/`$1`，最多 3 次、间隔 1 秒，只认退出码 0，全失败时打一行 DetailPrint）
    在 `RemoveVergeService` 两个卸载程序 `Abort` 之前（`!ifdef __UNINSTALL__`，安装程序展开不变）、在新的 `un.onUninstFailed`
    与 `un.onGUIEnd`（条件不变）里调用。节末交还与 `un.onUninstSuccess` 不变。
  - BRICK-W4：卸载可以在 Tono 的 NRPT 全匹配规则（「.」→ 198.18.0.2）仍在时完成。改后阶梯第 3 档也尝试恢复解析策略
    （不带 `?`，结果并入报错，仍返回 Err）；新函数 `remove_tono_resolver_rule_within`（只删 Tono 的键、不存在算成功、删后读回；
    `DNS_OPERATION.try_lock`，在名为 `tono-nrpt-sweep` 的独立线程上跑，`recv_timeout` 10 秒，超时就放弃线程；不用
    `spawn_blocking` 也不用楔住锁存）由紧急解除在 WFP 与意图删除之后、报告 DNS 结果之前调用，删不掉就返回
    `TONO_DNS_POLICY_REMAINS`（从不带 `TONO_WFP_REMOVED`）；卸载助手在快路径与完整路径的最终结果上都套
    `with_resolver_rule_proof`，只有规则证明已删才能 exit 0/2/4，否则 exit 3（`final_uninstall_cleanup` 因此跳过，产品文件保留）。
    删除行为不变。CLI（开始菜单「恢复网络」）新增 `ResolverRuleRemains` 一类，最先判断，中英文说明并返回 Err；
    `EnforcementGoneDnsStale` 不再叫人重启，改为设置路径；助手 exit 4 的文字说屏障与 NRPT 规则已删、适配器 DNS 仍可能指向
    已停止的解析器，并给设置路径。
- 新增/优化：无新界面文字、无新状态字段、无新语言键；`PROTOCOL_REVISION` 仍为 17；`UpdateStatus.successor_relaunched` 与
  `DesiredState.boot_session` 都是可缺省的新增字段；退出码仍是 0/2/3/4。
- 工程与测试：有界关闭——助手的三个 runtime（快路径探测、解除、重探）改走 `shared::block_on_abandoning`（`block_on` 后
  `shutdown_background`），CLI 在 `block_on` 后调用 `rt.shutdown_background()`：tokio 的 runtime drop 会等 `spawn_blocking`，
  超时被放弃的 DNS/WFP 引擎调用因此能把卸载重新卡住。每个行为一条回归（T1–T11）：
  `core::desired::owner_tests::{restore_holds_a_run_intent_recorded_in_an_earlier_boot, restore_never_replays_a_run_intent_without_a_wanted_barrier}`、
  `core::dns::tests::{uninstall_rung_three_still_restores_the_resolver_policy, the_resolver_rule_sweep_gives_up_on_a_hung_call}`、
  `core::windows_kill_switch::tests::emergency_disarm_blocks_uninstall_while_the_nrpt_rule_remains`、
  `update_transaction::tests::update_adoption_by_a_later_incarnation_reports_a_relaunch`、
  `tono-service-uninstall` 的 `tests::{a_remaining_nrpt_rule_stops_the_uninstall, block_on_abandoning_returns_while_a_blocking_call_hangs}`、
  `tono-service` 的 `disarm_error_tests::a_remaining_nrpt_rule_is_its_own_outcome`、
  App 的 `tono::commands::restore::barrier_before_me_tests::an_uncertain_or_relaunched_adoption_never_starts_the_recovery_connect`、
  `windows-packaging.test.mjs` 的「every uninstaller abort hands the manual lease back first」。红提交按仓库惯例带能编译、行为不变的骨架。
  红提交分三次推送：cargo 默认在第一个失败的测试二进制处停下（lib → `tono-service` → `tono-service-uninstall`），一次推完只能看到 lib 的红。
- 验证：MacBook 未运行 cargo、Tauri 或 NSIS（非构建主机），只用 `rustfmt --edition 2024 --check` 看过改动（无新增格式差异；
  `boot_session.rs` 已格式化）并在本机跑了 `node --test`（`test:dev-control` 六个文件 111 条通过，其中 T2 在红提交上失败、修复后通过）。
  - 红 A `4c8c1444`：Windows CI [36542644595](https://github.com/raydocs/tono/actions/runs/36542644595) 失败：`service` 只有 `tono-service-uninstall` 的 T5（`a remaining NRPT rule must block the uninstall: RestoredToAutomatic(...)`）
    与 T10（`left: None, right: Some(7)`）失败（lib 336 条与其他二进制全过）；`app` 只有 T2 失败（`the hand-back preserves $0 and $1`）；
    `app-rust` 只有 T8 失败（553 过 1 败，`a lost Adopt answer followed by a same-process retry started the recovery Connect`）；`core` 通过。
  - 红 B `bbe68304`：Windows CI [36544079506](https://github.com/raydocs/tono/actions/runs/36544079506) 失败：`service` 只有 `tono-service` 的 T6 失败（`left: EnforcementGoneDnsStale`，`right: ResolverRuleRemains`）；T2、T8 仍红。
  - 红 C `7ec62f49`：Windows CI [36545320927](https://github.com/raydocs/tono/actions/runs/36545320927) 失败：`service` lib 只有 T1、T11、T3、T4、T7、T9 失败（336 过 6 败），都是断言：T1/T11 的恢复一路走到 Core 启动（`Err(Windows core requires a Windows owner identity)`），T3 `left: 0, right: 1`，T4 报文带 `TONO_WFP_REMOVED`，T7 未报重新启动，T9 `Err(Timeout)`；T2、T8 仍红。
  - 修复 `f93212ec`：Windows CI [36546525623](https://github.com/raydocs/tono/actions/runs/36546525623) 失败：`service` 编译错误 E0063（`core/update.rs` 的 `status()` 漏了新字段），`app`、`app-rust`、`core` 通过；编译修正 `82d0a598`：Windows CI [36548082275](https://github.com/raydocs/tono/actions/runs/36548082275) 四个作业全过，T1–T11 按名列出并通过（service lib 342、`tono-service` 2、卸载助手 22、`app-rust` 554、打包脚本 111），T7 在不带 `test` 特性的更新准入步骤里也通过。本记录提交只改文档，它的 CI 见 #680。
  - 未执行：计划 §5 的一次性分支检查（`windows-candidate.yml` 编译 NSIS、改名卸载助手的中止路径、拒删 NRPT 键的助手直跑、
    `#[ignore]` 真注册表测试）；`windows-candidate.yml` 与 `windows-installer-smoke.yml` 未在本头上跑；设备检查 D1、D2、D4、D6 未做。
- 候选/发布：仅源码，无新候选。
- 剩余限制：
  - BRICK-W1：没有「意外重启」提示；登出释放没完成的计划内重启之后也要点一次 Retry；保持期间「更新恢复未完成」横幅与
    Protected Offline 同时显示；Adopt 失败时该 App 进程也保持；48 小时收据过期后的死路仍在（BRICK-W6）；崩溃循环本身未证实；
    注册表语义（易失键在重启、蓝屏、断电后消失，快速启动保留）只凭文档，未实机观察。
  - BRICK-W2：卸载程序被杀、或 3 次交还都失败时租约照旧留下；GUI 模式下「Tono 正在运行」处取消或结束失败后，失败页关闭之前
    租约仍被持有（计划评审 38c453fa/codex:F1，minor：`CheckIfAppIsRunning` 是 Tauri 的宏，要在它的 `Abort` 前交还得复制改写这个宏，
    不是小改动，本 PR 未做）；Service 半边在 PLAN-win-release-paths 的 PR。
  - BRICK-W4：W3 计划落地前 exit 3 仍删 Service（开始菜单快捷方式与重跑卸载程序会再清扫）；exit 4 时适配器 DNS 仍可能指向
    已停止的解析器；NSIS 的 exit 3 中止文字仍说「kill switch may still be installed」（归 W3 计划）；管理员能否删掉 SYSTEM 建的
    NRPT 键并读回未实机验证。
  - 计划评审 38c453fa/codex:F2（minor）：计划写的实现档位 Opus high 低于 xhigh；本次实现由 Jev 决定 9b3d278d 派发。
- 续记（2026-09-29，评审修正轮）：PR #680 代码评审（三家、max）无 major，按停止规则修一轮 minor：
  - 代码评审 codex:F1：助手放弃超时的 DNS runtime 后 `process::exit`，DNS 引擎起的 powershell.exe 只靠工作线程上的 guard 杀，
    进程退出跳过它；修复门释放后迟到的恢复脚本可能覆盖新装的 DNS。CLI 的 `shutdown_background` 同理。改后
    `core/process.rs` 新增 `bind_to_process_exit`：`spawn_before_deadline` 在交出子进程前把它放进本进程持有、到退出才关闭的
    kill-on-close Job Object，进程退出即结束仍在跑的子进程。放不进去只记 warn，退回原先由 guard 杀的行为。剩余：子进程在
    创建和入 Job 之间起的孙进程不在 Job 里；已交给 WMI 提供程序（WmiPrvSE）的单个 CIM 调用不随 powershell 结束而撤回。回归：
    `core::process::tests::closing_the_exit_job_ends_a_bound_helper`（Windows）。
  - 代码评审 opus:F2：紧急解除里第一次 NRPT 清扫失败时，函数在给 DNS 结果分类之前就返回，精确恢复的结果丢失；助手分类器
    不认 `TONO_DNS_POLICY_REMAINS`，重探后包成 `TONO_WFP_REMOVED`，最终清扫成功就 exit 4 并说「改回自动（DHCP）」，实际 DNS
    是精确恢复的，应为 exit 0。改后紧急解除先算出 DNS 结果，清扫失败时报文以 `TONO_DNS_POLICY_REMAINS` 开头、后接原样的 DNS
    结果（这推翻了上面 BRICK-W4 里「从不带 `TONO_WFP_REMOVED`」一句；CLI 先判这个标记）；助手分类器认这个标记：
    后面带 DNS 标记为 `RestoredToAutomatic`，不带为 `Clean`，两者都再经 `with_resolver_rule_proof` 清扫，规则未证明删除仍 exit 3。
    T4 改为断言报文以该标记开头并带 DNS 结果；T5 加一条断言：标记加精确恢复、最终清扫成功为 exit 0。
  - 计划的两项产品决定记入 [DECISIONS](../DECISIONS.md)（provisional）：意外重启后保持 Core 不启动且不加提示；原生更新恢复的
    自动重连跨重启保持。
  - 验证：MacBook 只跑了 `rustfmt --edition 2024 --check`（改动处无格式差异）；Windows CI 结果见 #680。
- 续记（2026-09-29，并入 main）：#681（PLAN-win-release-min，Service 半边的 BRICK-W2）已合入 main `7a4b748d`，本分支合并
  origin/main（合并提交，不改写历史）。`core/update.rs` 与 `update_transaction.rs` 自动合并：#681 的准入、start-only 与
  exit 74 逻辑原样保留（相对 main 的差异只剩本 PR 的三处），本 PR 的 `adopt_successor` 与 `successor_relaunched` 仍在 Adopt 分支与 `status()` 里。手工解决两处：
  `docs/findings.d/BRICK-W2.md`（两个 PR 各建一份，并成一行：Service 半边 #681 已合、NSIS 半边 #680 in-PR，保留 GUI 取消限制）；
  `docs/DECISIONS.md`（同一位置两边都新增条目，两条都保留）。Windows CI 结果见 #680。
- 续记（2026-09-29，复评）：#680 复评通过，满足停止规则，不再改代码。两项 minor 记为 open：
  [R680-dns-child-job-window](../findings.d/R680-dns-child-job-window.md)（powershell 创建后才入退出 Job，创建与入 Job 之间退出或入 Job
  失败时恢复脚本可比助手活得久；复评 codex:F1、opus:F1）；[R680-dns-marker-doc-stale](../findings.d/R680-dns-marker-doc-stale.md)
  （`TONO_DNS_POLICY_REMAINS` 与卸载阻塞条件的文档注释仍是旧语义；复评 opus:F2）。
