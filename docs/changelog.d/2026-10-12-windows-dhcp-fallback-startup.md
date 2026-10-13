## 2026-10-12 · Windows 精确 DNS 恢复失败后，把仍指向 Tono 解析器的网卡重置为 DHCP，由重启后的 Service 兜底
- 归属：SHIP_PLAN §2 item 10；Windows Service（`apps/windows/service`，DNS 引擎与 WFP 紧急解除、启动恢复）。
- 来源：基线 main `57776e805`；分支 `claude/win-dhcp-fallback-startup`，PR #1605（草稿）；尚未合 main。取代已关闭的 PR #1590 的 Service 部分（App 侧重试已在 #1599）。
- 缺陷修复：非卸载的紧急解除（释放服务 `clean_up`，即「恢复正常网络」按钮；非阶梯的更新执行器恢复）在精确恢复的适配器证明失败后，WFP 已拆除，但仍指向 Tono 目标（198.18.0.2 / 回环）的网卡留在死掉的解析器上。关联发现：`WIN-NRPT-KEPT-AFTER-EMERGENCY-DISARM`。
- 为什么放弃 #1590 的做法：它想在释放工作线程 45 秒的清理里完成 DHCP 重置，七轮审查都卡在同一点——被放弃的精确恢复的 `spawn_blocking` 线程会无限期持有 DNS 引擎的单写者占用（`DNS_CALL_IN_FLIGHT`），任何在 45 秒内的等待/保底/重试算术都无法保证重置真的跑到。
- 新设计（两处，一个共享函数）：
  1. 共享函数 `dns::reset_redirected_adapters_to_automatic()`（`dns/uninstall.rs`）：持 `DNS_OPERATION`，读取候选网卡（快照里的 ∪ 活动的）、按地址族分别评估（注册表 + 有效解析列表；快照里用户自己的回环豁免）、只把读作 Tono 目标的地址族重置为自动（DHCP）、回读验证、保留快照文件、再 `restore_resolver_policy()`。引擎忙（占用被持有，错误带 `DNS_ENGINE_WEDGED_PREFIX`）时立刻返回该错误，不等待、不重试。
  2. 紧急解除（`windows_kill_switch/emergency.rs`，仅非阶梯分支）：顺序不变（恢复 → 墓碑 → AI 保留 → 拆 WFP → 后续 → 意图 → NRPT 清扫 → 结果）；调用方给了期限（释放工作线程，`emergency_disarm_windows_kill_switch_until`）时精确恢复限 10 秒，无期限仍是 `DNS_RESTORE_TIMEOUT` 40 秒；NRPT 清扫之后、DNS 结果为错误或超时时调用共享函数**一次**：成功/失败都只作为 `TONO_DNS_FALLBACK` 备注附在原错误后，引擎忙则记「推迟到主 Service 的启动恢复」；返回的仍是原错误，调用方不会把它读成「已恢复」。
  3. 启动恢复（`windows_kill_switch/startup.rs`）：释放工作线程清理后总会重启主 Service，这个新进程有干净的占用槽、没有清理期限。`restore_on_service_start` 的无意图、未要求意图两个分支（以及启动释放重试循环里的同一处）在 `ensure_restored()` 失败时 spawn 一个脱离的 tokio 任务 `spawn_dns_fallback_after_failed_startup_restore()` 后照常返回（启动路径不变长）；任务最多 `STARTUP_DNS_FALLBACK_BOUND` = 90 秒：成功则记录被重置的 GUID 并停止，引擎忙则 1 秒后重试，其它错误记录后停止；保护被重新布防（`ARMED`）则停止，不撤销新连接有意的重定向。要求意图（重新布防）的分支从不 spawn。
- 新增/优化：无。
- 工程与测试：全部为桩引擎测试（无需 Windows 设备）。新测试钩子：真实占用的持有者 `park_engine_call`（经 `bounded_dns_call` 超时后线程仍占着占用，沿用 `dns/tests.rs` 里 mpsc 通道的做法）、有效 DNS / 离线注册表状态、NRPT 清扫计数；桩引擎的读写在占用被持有时同样拒绝。回归：`dns/tests.rs` 的范围测试（有效列表仍为 Tono、已恢复的网卡不动、用户自己的回环不动、离线快照网卡、读回仍为 Tono 则不算成功、快照保留与策略恢复、引擎忙立即拒绝），`windows_kill_switch/tests.rs` 的 T2–T6（紧急解除空闲时重置一次且返回原错误加备注、占用被持有时 1 秒内拒绝且 NRPT 清扫照常、启动无意图/未要求意图在返回后由脱离任务重置、要求意图不 spawn、占用 2 秒类的释放后重试、永不释放则在边界停止——边界由注入参数缩短，不用全局除数）。
- 验证：先红后绿，红的运行见 PR 正文（ci-gate 运行 38334785404，测试提交 `5b47ceb7c`，19 个测试失败）。未在本机运行 cargo（仅 hosted CI）。独立 Codex 审查按 AGENTS.md 对该高风险 diff 仍需在合并前完成，记录在 PR 评论。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无实机验证（需确认「恢复正常网络」后系统解析走家宽 DNS）；释放工作线程的报告可能仍把 DNS 写成残留/读不出，因为兜底在报告之后由重启的 Service 完成；新进程里引擎本身若也卡住，兜底在 90 秒处停止，快照保留，下一次启动再试；`--emergency-disarm` 命令行与开始菜单入口走卸载阶梯，不经过此分支。
