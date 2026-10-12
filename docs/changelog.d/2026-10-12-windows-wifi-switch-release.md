## 2026-10-12 · Windows 换 Wi-Fi 后无网：紧急解除后重置仍被重定向的网卡并移除解析策略
- 归属：SHIP_PLAN §2 item 10（连不上且无下一手）；Windows Service（`apps/windows/service`）。App 侧「被拒的健康释放重试」已拆到另一个 PR（分支 `claude/wifi-switch-win-app-retry`），不在本 PR 的变更说明里。
- 来源：基线 main fd438f627 → 分支 `claude/wifi-switch-win-release-retry`，PR [#1590](https://github.com/raydocs/tono/pull/1590)（草稿，未合 main）。
  实现提交见 PR 正文的 ci-gate 记录。
- 缺陷修复：
  - 客户报告：从手机热点切到酒店/办公室 Wi-Fi 后整台电脑没有可用网络，卸载 Tono 才恢复。
  - Service：非卸载的 `emergency_disarm_with`（覆盖释放服务 `clean_up`，即 App「恢复正常网络」按钮走的 #1569 释放服务，以及不带卸载阶梯的更新执行器恢复；
    `--emergency-disarm` 命令行与开始菜单入口会设 `TONO_UNINSTALL_DNS_LADDER=1`，本来就走卸载阶梯，被 `!uninstall_ladder_requested()` 排除在新分支之外，不在本改动范围）
    在 `restore_protected` 适配器证明失败时，WFP 移除后
    仍在 198.18.0.2/回环上的网卡没人处理，解析全部去一个没人应答的地址。现在 WFP 与意图清理之后，对这些网卡做与卸载阶梯第 2 档相同的重置（自动/DHCP，双栈），
    再调用 `restore_resolver_policy`（NRPT 与 Encrypted DNS）；快照文件保留，之后仍可精确还原；原 DNS 错误照旧返回。只重置仍在 Tono 目标上的网卡（目标的选取见下方 2026-10-12 续记）。
    起草时以为 NRPT 在此路径会残留；实际 main 上 BRICK-W4 的 `remove_tono_resolver_rule_within` 已在 WFP 之后删除 NRPT 规则，所以这里补的是网卡重置和 DoH 还原，不是 NRPT 本身。
  - 所有者规则：释放之后机器必须经家宽 DNS 解析，不能经已经停掉的 Tono 解析器；保存的原值证明不了时，自动（DHCP）可以接受。WFP 武装期间任何 DNS 都不得从物理网卡发出，
    本改动没有新增或放宽 53/853 的放行，网卡重置只在 WFP 移除之后进行。
- 新增/优化：无。严格/非严格策略、窄 AI 保持均未改。
- 没有改的相关项：
  - 决定 060 的「缺失上行（missing uplink）宽限」没有实现；本交付不让缺上行的会话降级。
  - DNS 门语义没有改：`disarm_unlocked`、`ensure_restored`、`accepts_degraded_restore`、卸载阶梯、任何 WFP 过滤器都原样。
- 工程与测试：Service 一例 `emergency_disarm_with_unproven_dns_resets_the_redirected_adapter_and_drops_the_resolver_policy`，并让 DNS 测试桩记录被重置的网卡。
- 验证：本机不跑 Windows 工作区的 cargo；由 hosted CI 判定，ci-gate 结果见 PR 正文。无真机验证。
- 候选/发布：无新包，仅源码。
- 剩余限制：待实机（紧急解除后网卡回到 DHCP 且解析正常）；合并前需要独立 Codex 复核（WFP/特权路径）；不启用自动合并。

### 续记 2026-10-12 · Codex 复核第 1 轮（gpt-6.1-sol，high，对 2bde04f37）：FAIL，4 条（F1 属 App 重试，已拆到另一个 PR，不再记于此），同一轮全部处理
- 回归先行：`51ace0e4a`（只含测试和测试桩）在 hosted CI 上失败的正是这些 Service 用例（run 38289503639）：
  `core::dns::tests::the_emergency_reset_selects_an_adapter_whose_effective_dns_is_still_tono`、
  `core::dns::tests::the_emergency_reset_is_not_a_success_while_the_read_back_still_shows_tono`、
  `core::dns::tests::the_emergency_reset_covers_an_adapter_whose_saved_original_was_a_local_resolver`、
  `core::dns::tests::the_emergency_reset_leaves_an_unrecorded_adapter_on_the_users_own_loopback_alone`（service）。
- F2（主要）DHCP 目标只看注册表：精确还原即使实时应用失败也会把用户的注册表值写回，于是有效 DNS 仍是 198.18.0.2、注册表却是 1.1.1.1 的网卡被跳过，机器停在死解析器上；
  回退还信任应用返回值而不回读。改为注册表与有效 DNS（`GetAdaptersAddresses` 的有效列表，新增 `engine_effective_dns`）逐网卡合并判断（`adapter_needs_automatic_reset`），
  重置后用 `engine_any_loopback` 回读有效状态，只有没有网卡仍读作 Tono 目标才算成功，否则返回错误（应用返回值不再作证）；注册表和有效 DNS 都是用户的网卡不动。
  `still_on_loopback=true` 的硬拒绝（`dns/restore.rs`）与 WFP 武装期间的行为没有改，没有新增 53/853 放行；重置仍只在 WFP 移除之后。
- F3（主要）回环排除两头都错：(1) 快照里原值含用户自己的 127.0.0.1、但当前值仍是 198.18.0.2 的网卡整张被排除；(2) 快照没记录、用户自己用 127.0.0.1/::1 的网卡满足宽谓词，被清成 DHCP。
  现在把「当前在 Tono 专用端点（198.18.0.2）」与「记录在案的旧回环重定向」分开：198.18.0.2 无论注册表还是有效 DNS 出现都算 Tono 的；
  纯回环只对快照记录过的网卡、且当前值不再是用户保存的那个原值时才算 Tono 的；未记录网卡上的纯回环不作为 Tono 所有权证据，不动。
- F4（次要）文档：`--emergency-disarm` 命令行和开始菜单入口设 `TONO_UNINSTALL_DNS_LADDER=1`，本来就走卸载阶梯，被 `!uninstall_ladder_requested()` 排除；上文与
  `WIN-NRPT-KEPT-AFTER-EMERGENCY-DISARM` 已改为：新分支覆盖释放服务 `clean_up`（「恢复正常网络」按钮，#1569）和不带阶梯的更新执行器恢复。
- 复核剩余风险（仅部分处理，第 2 轮 R2-F3 指出下面的做法会让慢失败的精确还原把重置挤掉，已在第 2 轮改为显式截止时间）：释放工作线程整个清理步骤的外层预算是 45 秒（`release/worker.rs`），而新回退腿原先用完整的 DNS 还原预算（40 秒）。
  现在 45 秒预算是 `EMERGENCY_DISARM_OUTER_BUDGET`（worker 直接引用，不会漂移），回退腿的预算为 `min(15 秒, 45 秒 − 已用时间 − 10 秒资源解析规则清扫)`，没有剩余时间则跳过并记录；
  被截断时随后的 `remove_tono_resolver_rule_within` 清扫仍删除 NRPT 规则。限制：若精确还原本身已耗尽 40 秒，回退腿没有时间，网卡留在 Tono 目标上，只靠清扫删 NRPT；该情形下返回的 DNS 错误和 `release_readback` 会如实报告 dns 残留。
- 工程与测试：除上列五例外新增 `windows_kill_switch::tests::the_emergency_fallback_leg_fits_inside_the_release_workers_budget`；DNS 测试桩新增有效 DNS（`set_effective_dns`）与「重置报告成功但没有落地」（`set_reset_does_not_land`）两个钩子。
- 验证：本机不跑 Windows 工作区的 cargo；修复提交由 hosted CI 判定，ci-gate 结果见 PR 正文。仍无真机验证。

### 续记 2026-10-12 · Codex 复核第 2 轮（对 2c96ac52d）：F1、F4 已解决；F2/F3 部分；预算修复带出 1 条新的主要问题，同一轮全部处理
- 回归先行：`4af083885`（测试、测试桩和显式截止时间的接口骨架，行为仍是旧的）在 hosted CI 上失败的正是这四例（run 38292895442）：
  `core::dns::tests::the_emergency_reset_does_not_claim_success_when_the_effective_dns_cannot_be_read`、
  `core::dns::tests::the_emergency_reset_is_not_proven_while_another_adapters_effective_dns_is_unreadable`、
  `core::dns::tests::the_emergency_reset_resets_only_the_family_still_on_tono_next_to_a_users_own_loopback`、
  `core::windows_kill_switch::tests::the_emergency_fallback_leg_fits_inside_the_release_workers_budget`。
- R2-F1（主要）有效 DNS 读失败被当成空列表：无注册表目标时不读回就报成功；有部分目标时读回只查已选网卡，漏掉「注册表已还原、有效 DNS 仍是 198.18.0.2」的网卡；原生读取还是全有或全无。
  现在每块网卡的有效状态是 `NotActive` / `Servers` / `Unknown`：整次读失败、或某块网卡的 DNS 记录读不出（原生层改为该网卡 `None`，不再拖垮整次枚举），都记为 `Unknown`，永远不是「空」。
  已记录在快照里、或注册表读作 Tono 的网卡，有效状态为 `Unknown` 时标记为「未证明」。重置后重新读取全部网卡并复用同一评估，覆盖当时枚举到的候选（仅活动网卡；快照里离线的网卡当时并没有被枚举，这一遗漏已在第 3 轮补上，见下），
  任何一块仍在 Tono 目标上或仍为 `Unknown` 都返回错误并记录 `fallback could not be proven`，不再报成功；没有目标时也只在每块候选都读到了才算成功。`still_on_loopback=true` 的硬拒绝、WFP 武装期间无 DNS 外泄的规则、53/853 均未改。
- R2-F2（主要）整网卡豁免忽略有效 DNS 和地址族：IPv4 原值是用户自己的 127.0.0.1、IPv6 原值是公共解析器，注册表已全部还原但 IPv6 实时应用失败、有效 IPv6 仍是 Tono 的 `::1`，整张网卡被跳过。
  现在逐地址族评估（`assess_adapter`）：某一族只有在「保存的原值是回环、注册表等于该原值、且有效列表（读到时）正是该原值」时才豁免；198.18.0.2 无论哪个视图出现都算 Tono 的。
  引擎本来支持逐族重置（每族 `None` 即自动/DHCP，保留的族原样写回），所以只重置仍在 Tono 上的那一族；例外：IPv4 被重置时，没有静态服务器的 IPv6 族跟着重置（与卸载阶梯一致，避免留下「保护态空 IPv6」）。
- R2-F3（主要）预算：`min(15 秒, 45 秒 − 已用时间 − 10 秒)` 在已用时间 ≥ 35 秒时整个跳过重置，而精确还原最长可用 40 秒，慢失败的还原保证重置不执行；更新执行器调用方也被套上不存在的 45 秒上限。
  现在截止时间是显式的：新增 `emergency_disarm_windows_kill_switch_until(deadline)`，释放工作线程传入自己的截止时间（`now + EMERGENCY_DISARM_OUTER_BUDGET`），更新执行器和其他调用方仍走无截止时间的入口，得到完整的 DNS 预算（精确还原 40 秒、重置腿 40 秒）。
  有截止时间时一开始就整体分配：重置腿（15 秒）和 NRPT 清扫（10 秒）先保留，精确还原只拿 `剩余 − 25 秒`（下限 5 秒，上限 40 秒；第 3 轮发现这没有计入中间的 WFP 清理，已改为 `剩余 − 50 秒`），只在这条 fail-open 的紧急路径上；正常的 `disarm_unlocked` 路径未动。
  被截断的精确还原在此路径上本来就只会报告部分/未知，而被跳过的重置会把死解析器留在机器上，所以取舍偏向保住重置（第 2 轮声称「预算内重置腿永不跳过」并不成立：精确还原 + WFP 清理一旦耗尽剩余时间，重置腿仍会被整个跳过，第 3 轮改为硬下限，见下）。NRPT 清扫的预算改为 `min(10 秒, 剩余)`（至少 2 秒，规则总会被尝试）。
- 残留：(1) NRPT 清扫内部是同步 `recv_timeout`，外层 Tokio 超时无法抢占，最多可在截止时间之后多占 `min(10 秒, 剩余)`（至少 2 秒）。(2) 精确还原被截断时，其引擎调用的阻塞线程可能仍在运行，引擎的在途标记会让紧接着的重置腿被拒绝并如实报错；极端慢的 PowerShell 批处理下仍可能出现。
  (3) 有效 DNS 读不出时，已记录网卡会让回退报「未证明」（即使用户确实用自己的本地解析器），回退返回错误；策略移除不受影响，原 DNS 错误照旧返回。
- 工程与测试：除上列四例外新增 `windows_kill_switch::tests::the_emergency_legs_keep_the_full_dns_budgets_without_a_caller_deadline`；DNS 测试桩新增 `set_effective_dns_unreadable`、`set_effective_dns_fails`，并让逐族重置真实地改写桩里的注册表值和有效列表。
- 验证：本机不跑 Windows 工作区的 cargo；修复提交由 hosted CI 判定，ci-gate 结果见 PR 正文。仍无真机验证。

### 续记 2026-10-12 · Codex 复核第 3 轮（对 a02865f18）：R2-F1、R2-F2、原 F3 已解决；R2-F3 与原 F2 部分；剩 2 条主要问题，经负责人批准的最后一轮，按两项决定实施
- 回归先行：`ecd5b52c9` 的测试提交里，发布工作线程模块在 test 特性下不编译，测试引用不到它，service 作业编译失败（run 38298592633，不算红灯证据）；`3af3de400`（把行为不变的备注骨架挪到始终编译的预算代码里）在 hosted CI 上失败的正是这七例（run 38300000568，其余 app-rust/core/app 通过，断言失败而非编译错误）：
  `core::dns::tests::the_emergency_reset_covers_a_snapshot_adapter_that_is_offline`、
  `core::dns::tests::the_emergency_reset_is_not_proven_while_an_offline_snapshot_adapters_registry_is_unreadable`、
  `core::windows_kill_switch::tests::the_emergency_fallback_leg_has_a_hard_floor_once_wfp_is_gone`、
  `core::windows_kill_switch::tests::the_reset_leg_still_runs_after_a_slow_restore_and_a_slow_wfp_cleanup`、
  `core::windows_kill_switch::tests::the_exact_restore_budget_reserves_the_wfp_cleanup_too`、
  `core::windows_kill_switch::tests::emergency_disarm_resets_the_redirected_adapter_even_when_the_deadline_is_already_spent`、
  `core::windows_kill_switch::tests::a_disarm_that_overran_its_budget_leaves_a_note_and_one_within_it_does_not`。
- R3-F1（主要）预算：重置腿 15 秒和清扫 10 秒的预留没有计入精确还原与重置之间的 WFP 清理（单次引擎调用最长 25 秒，外加 BFE 探测）。可达情形：45 秒截止、还原约 20 秒失败、WFP 清理 16 秒，剩余约 9 秒，`saturating_sub(10 秒)` 得 0，整个重置 + DoH 腿被跳过，此时 WFP 已移除、网卡留在死解析器上。
  负责人决定：WFP 一旦被移除，DNS 重置腿永不跳过，无论截止时间还剩多少都至少给 10 秒（`EMERGENCY_RESET_FLOOR`），上限仍是 15 秒；NRPT 清扫的 2 秒下限不变。
  当时还把 WFP 清理的预算计入预留（精确还原 = `clamp(剩余 − 50 秒, 5 秒, 40 秒)`）；这一条在第 4 轮被固定 10 秒取代，见下。放弃了 `budget.is_zero()` 的跳过分支。无截止时间的调用方（更新执行器）仍得到完整的 DNS 预算。
  代价与如实报告：释放工作线程可能超出自己的 45 秒（重置腿下限 10 秒 + 清扫下限 2 秒）。外层超时因此放宽 `EMERGENCY_DISARM_OVERRUN_GRACE`（15 秒），不会把保住机器 DNS 的那一腿切掉；清理实际用时超过 45 秒时记一条
  「清理超出了 45 秒预算」的备注（`emergency_overrun_note`），任何备注都使结果不能是「restored」，保持 partial/unknown，由第二次读回判定各组件。负责人宁要迟到的 unknown，也不要死解析器；但「迟到」只对 `/release/status` 可见，不是对按钮那次点击的答复（见第 4 轮 R4-F2）。
- R3-F2（主要）候选集：回退的候选从 `collect_dns_adapters()`（只含已启用且有绑定 IP 的活动网卡）出发，快照里记录的、离线/已禁用且注册表仍在 Tono 目标上的网卡从来不是候选。精确还原逐个写注册表、遇错即返回，这样的网卡可能被落下；
  回退在在线网卡上「成功」，网卡回来后经死目标解析，且 `PROTECTION_WANTED=false`（看门狗不会再修）。
  现在候选 = 快照里的 GUID ∪ 当前活动网卡（沿用卸载阶梯读快照 GUID 的做法）。不在活动枚举里的快照网卡按 GUID 直接读注册表（`engine_read_registry_adapters`，仅注册表，没有有效列表），仍在 Tono 目标上的那一族被重置（引擎写注册表，网卡回来时读到的是自动/DHCP）。
  不在活动枚举里从不等于「已还原」：快照网卡的注册表读不出时记为「未证明」，回退返回错误。重置后的读回覆盖同一并集。键根本不存在（网卡已被移除）读作「全部缺省」，这是答案，不算读失败。
- 工程与测试：新增 `dns::tests::the_emergency_reset_covers_a_snapshot_adapter_that_is_offline`、`…_is_not_proven_while_an_offline_snapshot_adapters_registry_is_unreadable`、
  `windows_kill_switch::tests::the_emergency_fallback_leg_has_a_hard_floor_once_wfp_is_gone`（替换原 `…fits_inside_the_release_workers_budget`）、`the_reset_leg_still_runs_after_a_slow_restore_and_a_slow_wfp_cleanup`（还原 20 秒 + WFP 16 秒、45 秒截止，剩 9 秒仍至少 10 秒）、
  `the_exact_restore_budget_reserves_the_wfp_cleanup_too`（第 4 轮由 `the_exact_restore_gets_ten_seconds_under_the_workers_deadline` 取代）、`emergency_disarm_resets_the_redirected_adapter_even_when_the_deadline_is_already_spent`、`windows_kill_switch::tests::a_disarm_that_overran_its_budget_leaves_a_note_and_one_within_it_does_not`。DNS 测试桩新增离线注册表模型（`set_offline_registry`、`set_offline_registry_unreadable`），逐族重置同时改写它。
- 残留：(1) 重置腿下限意味着释放工作线程最多可超出 45 秒约 12 秒（重置 10 秒 + 清扫 2 秒），外层超时放宽 15 秒；超出时结果是「unknown」。清扫仍是同步 `recv_timeout`，外层 Tokio 超时无法抢占。
  (2) 对离线网卡只写注册表，没有「有效 DNS」可读；网卡回来后由 DNS 客户端按注册表（自动/DHCP）重新取得。快照里的网卡若注册表读不出，回退保持「未证明」。(3) 仍无真机验证。
- 验证：本机不跑 Windows 工作区的 cargo；修复提交由 hosted CI 判定，ci-gate 结果见 PR 正文。

### 续记 2026-10-12 · Codex 复核第 4 轮（对 be3897725）：R3-F1、R3-F2 已解决；新 1 条主要（R4-F1）、1 条次要（R4-F2），同一轮处理
- 所有者产品规则（2026-10-12）：用户最多愿意等约 35 秒得到结果，不要 90 秒预算。所以常见情形下网络必须在首次答复窗口内（服务 25 秒答复、客户端等 32 秒）恢复。
- 回归先行：`42838a4a5` 只含测试和测试桩（桩在有人占着引擎单写者声明时拒绝，与 `bounded_dns_call` 一致），在 hosted CI 上失败的正是这四例（run 38306067481，其余作业通过，断言失败而非编译错误）：
  `core::dns::tests::the_emergency_reset_waits_for_an_in_flight_engine_call_and_then_resets`、
  `core::dns::tests::the_emergency_reset_is_not_refused_at_once_while_an_engine_call_holds_the_claim`、
  `core::windows_kill_switch::tests::a_claim_that_is_never_released_leaves_the_fallback_unproven_after_waiting_its_budget`、
  `core::windows_kill_switch::tests::the_exact_restore_gets_ten_seconds_under_the_workers_deadline`。
- R4-F1（主要）：释放工作线程的 45 秒截止下，第 3 轮的预留总和 50 秒，使精确还原永远只拿 5 秒下限；而外层超时只是丢弃 future，引擎调用仍在 `spawn_blocking` 线程上跑、继续持有引擎单写者声明
  （`dns/engine_ops.rs` 的 `bounded_dns_call` / `DnsCallClaim`）。WFP 移除（很快）之后回退腿的 `collect_dns_adapters()` 与策略还原都被这条声明立即拒绝，重置腿的 10 秒下限根本用不上，工作线程第二次清理只在读回为 `residual` 时才触发，
  结果是 WFP 已移除、有效 DNS 还在死目标上。
  现在：(1) 精确还原预算固定 10 秒（`EMERGENCY_RESTORE_BUDGET`，不超过剩余，下限 5 秒；无截止时间的调用方仍是 40 秒）；之后是 WFP 移除（自带 25 秒上限，正常是毫秒级）；
  (2) 精确还原失败或超时后进入回退腿，`reset_redirected_adapters_after_failed_restore` 先持 DNS 操作锁，再 `wait_for_dns_engine_idle()` 轮询（50 毫秒）等那条声明被释放，然后才做 DHCP 重置和策略还原；立即被拒绝不再算作用掉预算（第 5 轮把等待和重置的预算拆开，见下）。
  （第 5 轮指出这里等待和重置共用同一个 ≤15 秒超时，已拆开，见第 5 轮。）
- R4-F2（次要）第 3 轮写的「迟到的 unknown 更好」夸大了：发布服务 25 秒答复、客户端等 32 秒、App 在第一次答复上就结算（`release_wire.rs`、`release/daemon.rs`、App `core/service/mod.rs`、`preemptive.rs`），后台的最终报告不会送回原来那次点击。
  本 PR 不改 25 秒答复和 32 秒客户端等待。改为让最终结果在 `/release/status` 的下一次读取里可见：`ReleaseStatus` 新增可选 `report`（旧响应没有该字段仍可解析），`release/daemon.rs` 的 `status()` 返回当前或最近一次 run 的报告
  （按 `answer` 的口径：未完成则标记 `finished=false` 且风险未证明），其中含工作线程的逐组件读回和 `detail`，`detail` 里有「清理超出 45 秒预算」的备注，`finalize` 追加的原因也在其中。
  App 现有的状态轮询只读 `mode`/`generation`/`running`，不会展示它：界面需要后续工作来显示「仍在恢复… / 最终结果」，不在本 PR 范围（见 PR 的限制一节）。
- 测试：见上四例；`release_wire::tests::the_status_carries_the_final_report_and_an_older_status_still_parses` 覆盖状态载荷的往返与向后兼容（随修复提交，不是红灯用例）。
  发布服务守护进程（`release/daemon.rs`）和工作线程（`release/worker.rs`）只在 Windows 非 test 特性下编译，没有 service 测试能驱动它们；这两处的接线只由非 test 的 Windows 作业编译，无自动化行为测试。
- App 侧移出：被拒的健康释放重试（`monitor.rs` 的 `settle_health_release` 及其测试）和 `WIN-RELEASE-REFUSED-NO-RETRY` 记录已拆到分支 `claude/wifi-switch-win-app-retry`；本说明与 PR 正文不再把它们记为本 PR 的内容（该记录现在属于 PR #1599，第 5 轮已从本分支删除，避免同一 ID 冲突）。本分支上的 `monitor.rs` 没有回退，待拆出的 PR 先合入后再并入 main。
- 残留：(1) 引擎调用若在等待预算和重置腿预算内一直不释放声明（例如 Dnscache 真卡死），回退腿报「未证明」，网卡可能仍在死目标上；NRPT 清扫仍会删规则。(2) 这几段合计可能超出 45 秒（第 5 轮给出估算），超出时有备注，结果只会是 partial/unknown。(3) 仍无真机验证。
- 验证：本机不跑 Windows 工作区的 cargo；修复提交由 hosted CI 判定，ci-gate 结果见 PR 正文。

### 续记 2026-10-12 · Codex 复核第 5 轮（xhigh，对 7907605b1）：R4-F1 部分、R4-F2 部分；再做一轮，仅 Service 侧
- 回归先行：`594218606` 只含测试和测试基础设施（测试用的预算除数、桩引擎记录被拒绝的时刻、等待预算的接口骨架，行为仍是旧的），在 hosted CI 上失败的正是下列用例（run 38310251132），见 PR 正文的 ci-gate 表：
  `core::windows_kill_switch::tests::the_claim_wait_budget_is_what_is_left_of_the_engine_calls_own_bound`、
  `core::windows_kill_switch::tests::a_claim_released_late_still_gets_its_adapter_reset_inside_the_legs_own_floor`、
  `core::windows_kill_switch::tests::a_claim_that_is_never_released_leaves_the_fallback_unproven_after_waiting_and_retrying`（替换第 4 轮的同类用例）、
  `core::dns::tests::the_emergency_reset_is_not_refused_at_once_while_an_engine_call_holds_the_claim`（补了「必须反复重试被拒绝的调用」的断言）。
- R5-F1（主要）：第 4 轮把「等声明释放」、候选读取、DHCP 应用、刷新、读回和策略还原都放在同一个 ≤15 秒超时里，10 秒下限对重置本身并不成立。
  反例：精确还原的引擎调用跑 26 秒（< 30 秒的 `DNS_APPLY_TIMEOUT`），10 秒处被外层放弃，WFP 很快，回退腿的 15 秒全花在等待上，约 25 秒时 future 被丢弃、没有重置；26 秒声明才释放，已经没有人在等。
  （第 6 轮已取代其中「自精确还原开始起算」的等待和「重置腿自己的 10 秒下限」两处：等待改为从引擎调用拿到声明的时刻算，下限改为从声明归还时起算，见下一节；以下数字 47 / 52 秒也已被第 6 轮的 52 秒（含 20 秒宽限）取代。）
  现在预算拆开：(1) 等声明有自己的预算 `emergency_claim_wait_budget` = `min(30 秒 − 自精确还原开始已用时间, 20 秒)`（`windows_kill_switch/state.rs`；30 秒是引擎调用自己的上限，`EMERGENCY_ENGINE_CALL_BOUND`），在 WFP 移除之后、重置腿之前由 `emergency.rs` 调用 `dns::wait_for_abandoned_dns_call` 执行，不计入重置腿；
  (2) 之后无论等到了声明被释放，还是等待预算用完声明仍被占着，重置腿都拿到自己的完整预算（下限 10 秒、上限 15 秒）去做读取、DHCP 应用、读回和策略还原；声明仍被占着时，重置腿自己每 50 毫秒重试被拒绝的调用（`reset_redirected_adapters_after_failed_restore` 里的重试循环，仅针对「引擎被占用」的拒绝，其他错误照常返回），而不是立刻失败。
  NRPT 清扫的 2 秒下限不变。此外不变：25 秒首次答复、32 秒客户端等待。
  预算估算（仅这几段，见 R5-F2）：精确还原 10 秒 + WFP 移除 + 等声明（自还原开始起至多到 30 秒，至多 20 秒）+ 重置腿 15 秒 + 清扫 2 秒，约 47 秒再加 WFP 移除；`EMERGENCY_DISARM_OVERRUN_GRACE` 仍是 15 秒，45 + 15 = 60 秒覆盖它（WFP 病态慢到 25 秒时约 52 秒）。宽限只决定工作线程什么时候结束，从不延迟首次答复：发布服务按自己的 25 秒截止答复。
  测试用预算除数把这些预算缩小到毫秒级（默认 1，只在 `cfg(test)` 存在），所以「声明在有限的晚时刻释放」不需要睡 12 秒。
- R5-F2（次要）：第 4 轮和 `state.rs` 里把「最坏约 52 秒 / 常见 10–20 秒」写成了端到端保证。改为只是这几段的预算估算；BFE 探测（至多 5 秒）、选择性后续处理、文件读写、读回、第二次清理、主服务重启和发布服务的 finalize 都不在其中；「常见」是未测量的估计，等真机数据。
- 清理与记录：从本分支删除 `docs/findings.d/WIN-RELEASE-REFUSED-NO-RETRY.md`（现在在 PR #1599，同一 ID 会冲突）。新增 `docs/findings.d/WIN-RELEASE-STATUS-REPORT-EXPOSURE.md`（open，低·推导）。
- 新增限制：`ReleaseStatus.report` 没有大小上限也没有脱敏（原始错误、网卡 GUID、路径、残留写者 PID），是整机范围而不是按请求者划分，并且可能属于更早的代号；UI 跟进必须按请求 ID / 代号核对后再展示，并先裁剪。
- 验证：本机不跑 Windows 工作区的 cargo；修复提交由 hosted CI 判定，ci-gate 结果见 PR 正文。仍无真机验证。

### 续记 2026-10-12 · Codex 复核第 6 轮（xhigh，对 d2bfd7793）：R6-F1 主要、R6-F2 次要；老板批准最后一轮，仅 Service 侧
- 回归先行：`963ade1af` 和 `dea317ed9` 只含测试和测试基础设施（桩引擎可延迟「声明归还后的第一次候选读取」、可模拟引擎调用自己超时、记录读取次数，预算的纯函数版本，`reset_redirected_adapters_within` 骨架仍是旧行为：从腿开始起算的单一超时），在 hosted CI 上失败的正是下列三例（run 38320257478，534 通过、3 失败，断言失败而非编译错误；上一次 `963ade1af` 的 run 38318798416 只红了前两例，端到端那例因为预算 15 秒上限而没有红，于是在 `dea317ed9` 把截止时间设为已用尽，让腿恰好只有 10 秒下限）：
  `core::dns::tests::the_reset_floor_runs_from_the_claim_return_and_not_from_the_start_of_the_leg`、
  `core::dns::tests::an_engine_timeout_is_an_answer_and_is_not_retried_like_a_refusal`、
  `core::windows_kill_switch::tests::a_claim_returned_after_the_wait_and_the_first_floor_still_gets_a_full_floor_to_reset`（端到端：声明在等待结束且腿的第一段下限用完之后才归还，归还后的第一次候选读取很慢；断言重置 1 次、策略还原执行、原始错误仍返回）。
- R6-F1（主要）：等声明的预算从 `restore_protected` 开始起算，而引擎调用的 30 秒上限从它**拿到声明**时起算，中间有锁等待和快照/退役标记的文件读取。反例：声明在 9 秒拿到，还原在 10 秒被放弃，这次调用（29 秒，在自己的上限内）38 秒归还；独立等待在 30 秒结束，重置腿的 10 秒下限到 40 秒，前 8 秒都在被拒绝，38 秒开始的候选读取在 40 秒被丢弃，DHCP 一次都没应用，WFP 已删，网卡留在死解析器上，worker 读回是 `unreadable`，「仅残留」的第二次清理也不触发，启动恢复只会警告。`state.rs` 里「声明在还原开始后 30 秒内归还」的注释也是错的，已改为「引擎调用拿到声明后 30 秒内，且仅对只是慢的调用成立」。
  现在：(1) 声明槽本来就记录调用拿到声明的时刻（`dns/engine_ops.rs` `bounded_dns_call` 里的 `started_at`），新增与 cfg 无关的访问器 `dns_engine_claim_held_for()`（`dns/uninstall.rs` 的 `abandoned_dns_call_held_for` 对外暴露），等待预算 = `min(30 秒 − 声明已被占用的时间, 20 秒)`，声明空闲则为 0（`emergency_claim_wait_budget(claim_held_for)`，`emergency.rs` 不再用 `restore_began`）。
  (2) 重置腿 `dns::reset_redirected_adapters_within(budget)`（`dns/uninstall.rs`）把下限从**声明归还时**起算：腿开始时声明空闲则从腿开始起算；否则每 25 毫秒看一次声明，第一次看到归还的时刻起再给一个完整的 `budget`（候选读取、DHCP 应用、读回、策略还原都在里面）；如果腿开始后 `budget` 内声明仍没归还，腿以「未证明」结束（并且声明被占用期间照旧每 50 毫秒重试被拒绝的调用），所以整段腿最长 2 × `budget`。25 秒首次答复、32 秒客户端等待不变，没有 90 秒的用户可见预算。
  (3) `EMERGENCY_DISARM_OVERRUN_GRACE` 从 15 秒提到 20 秒。最坏情形的算术（只针对这几段，非端到端保证）：精确还原在 10 秒被放弃（此时声明最晚在 10 秒被拿到）；等声明从 10 秒起至多 20 秒，到 30 秒；重置腿 30 秒起看声明，下限 10 秒，到 40 秒；引擎调用的 30 秒上限使声明最晚 40 秒归还，下限再从归还起 10 秒，到 50 秒；NRPT 清扫 2 秒下限，到 52 秒；加上 WFP 移除和文件写入。45 + 20 = 65 秒，余量 13 秒；15 秒的旧宽限（60 秒）余量只有 8 秒。声明一直不归还则腿在 40 秒结束，报「未证明」。BFE 探测、选择性后续处理、读回、第二次清理、重启和 finalize 仍不在内；仍无真机测量。
- 审阅者的 (b)：重置腿的重试曾以 `TONO_DNS_ENGINE_WEDGED` 文本为准，而引擎自己的超时也带这个前缀，于是一个真的跑过又超时的调用也会被当成「被占用」一直重试。现在拒绝（声明被占、什么都没跑）是类型化错误 `DnsEngineBusy`（`dns/engine_ops.rs` 的 `wedged_dns_error`，文本和前缀不变，旧断言照旧），重试只对它：`is_engine_busy_refusal` 用 `downcast_ref`，经过 `context` 包装也认得；引擎超时是结果，直接返回。
- R6-F2（次要）：全局 `cfg(test)` 预算除数被两个异步测试设为 20，污染四个没有 `#[serial]` 的测试。改为显式注入：`emergency_fallback_allowance` / `emergency_claim_wait_allowance` 是不带除数的纯函数，`*_budget` 只是 `scaled_for_tests(allowance)`；断言真实数字的五个测试读纯函数，端到端测试仍走带除数的版本。
- 其余测试：`dns::tests::the_reset_leg_gives_up_after_its_floor_when_the_claim_never_comes_back` 在测试提交里，骨架下就通过（守护「不归还则不无限等」，不是红灯用例）；随修复提交的还有 `dns::tests::the_claim_reports_how_long_it_has_been_held_from_the_moment_its_call_took_it` 和 `dns::tests::only_a_refusal_for_a_held_claim_is_a_busy_refusal`（访问器与类型化拒绝，同样不是红灯用例）。
- 验证：本机不跑 Windows 工作区的 cargo；修复提交由 hosted CI 判定，ci-gate 结果见 PR 正文。仍无真机验证。
