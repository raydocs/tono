## 2026-10-12 · Windows 换 Wi-Fi 后无网：被拒的健康释放重试；紧急解除后重置仍被重定向的网卡并移除解析策略
- 归属：SHIP_PLAN §2 item 10（连不上且无下一手）；Windows App（`apps/windows/app/src-tauri`）与 Windows Service（`apps/windows/service`）。
- 来源：基线 main fd438f627 → 分支 `claude/wifi-switch-win-release-retry`，PR [#1590](https://github.com/raydocs/tono/pull/1590)（草稿，未合 main）。
  实现提交见 PR 正文的 ci-gate 记录。
- 缺陷修复：
  - 客户报告：从手机热点切到酒店/办公室 Wi-Fi 后整台电脑没有可用网络，卸载 Tono 才恢复。
  - App：网络变化后数据面验证失败，`handle_network_change_inner` 调 `release_explicit_applying_narrow_with_guard`；Service 在 DNS 还原证明不了时拒绝
    （`disarm_unlocked` → `ensure_restored`，需要连续 3 次实时应用失败才接受降级还原），App 只记日志就返回，会话停在 Protected Offline、WFP 仍开，计数永远到不了 3。
    现在 `settle_health_release` 按监控节拍（2 秒，同一个任务，无新线程）重复同一个释放，直到成功或会话被用户结束/被新连接取代，每次重试 warn 日志一次；成功后进入原有无隧道探测。
    Service 的门一步不松：`still_on_loopback=true` 仍是硬拒绝，重试只是再问一次。
  - Service：非卸载的 `emergency_disarm_with`（覆盖释放服务 `clean_up`，即 App「恢复正常网络」按钮走的 #1569 释放服务，以及不带卸载阶梯的更新执行器恢复；
    `--emergency-disarm` 命令行与开始菜单入口会设 `TONO_UNINSTALL_DNS_LADDER=1`，本来就走卸载阶梯，被 `!uninstall_ladder_requested()` 排除在新分支之外，不在本改动范围）
    在 `restore_protected` 适配器证明失败时，WFP 移除后
    仍在 198.18.0.2/回环上的网卡没人处理，解析全部去一个没人应答的地址。现在 WFP 与意图清理之后，对这些网卡做与卸载阶梯第 2 档相同的重置（自动/DHCP，双栈），
    再调用 `restore_resolver_policy`（NRPT 与 Encrypted DNS）；快照文件保留，之后仍可精确还原；原 DNS 错误照旧返回。只重置仍在 Tono 目标上的网卡（目标的选取见下方 2026-10-12 续记）。
    起草时以为 NRPT 在此路径会残留；实际 main 上 BRICK-W4 的 `remove_tono_resolver_rule_within` 已在 WFP 之后删除 NRPT 规则，所以这里补的是网卡重置和 DoH 还原，不是 NRPT 本身。
  - 所有者规则：释放之后机器必须经家宽 DNS 解析，不能经已经停掉的 Tono 解析器；保存的原值证明不了时，自动（DHCP）可以接受。WFP 武装期间任何 DNS 都不得从物理网卡发出，
    本改动没有新增或放宽 53/853 的放行，网卡重置只在 WFP 移除之后进行。
- 新增/优化：无。严格/非严格策略、窄 AI 保持、无隧道探测均未改。
- 没有改的相关项：
  - 决定 060 的「缺失上行（missing uplink）宽限」没有实现；本交付不让缺上行的会话降级。
  - DNS 门语义没有改：`disarm_unlocked`、`ensure_restored`、`accepts_degraded_restore`、卸载阶梯、任何 WFP 过滤器都原样。
- 工程与测试：App 一例 `a_refused_health_release_is_retried_on_the_next_tick_and_then_starts_the_probe`（先以不重试的 `settle_health_release` 骨架提交，在 CI 上失败）；
  Service 一例 `emergency_disarm_with_unproven_dns_resets_the_redirected_adapter_and_drops_the_resolver_policy`，并让 DNS 测试桩记录被重置的网卡。
- 验证：本机不跑 Windows 工作区的 cargo；由 hosted CI 判定，ci-gate 结果见 PR 正文。无真机验证。
- 候选/发布：无新包，仅源码。
- 剩余限制：待实机（换 Wi-Fi 后重试放行、紧急解除后网卡回到 DHCP 且解析正常）；合并前需要独立 Codex 复核（WFP/特权路径）；不启用自动合并。

### 续记 2026-10-12 · Codex 复核第 1 轮（gpt-6.1-sol，high，对 2bde04f37）：FAIL，4 条，同一轮全部处理
- 回归先行：`51ace0e4a`（只含测试和测试桩）在 hosted CI 上失败的正是这五例（run 38289503639）：
  `tono::connection::monitor::tests::a_retry_overtaken_by_a_connect_while_waiting_for_the_writer_claims_no_release`（app-rust）；
  `core::dns::tests::the_emergency_reset_selects_an_adapter_whose_effective_dns_is_still_tono`、
  `core::dns::tests::the_emergency_reset_is_not_a_success_while_the_read_back_still_shows_tono`、
  `core::dns::tests::the_emergency_reset_covers_an_adapter_whose_saved_original_was_a_local_resolver`、
  `core::dns::tests::the_emergency_reset_leaves_an_unrecorded_adapter_on_the_users_own_loopback_alone`（service）。
- F1（主要）重试的会话检查与释放不是一步：检查通过后锁已放开，用户 Connect 可在此时被准入并推进 `connect_generation`，过期的重试随后拿到写者，释放工作线程读到的是当前（新）代号和发布票据，
  把新连接释放掉；成功后探测也读当前代号。改为 `claim_retry_release(state, generation)`：先取生命周期写者（Connect 准入持有读者并在持有期间推进代号，所以写者只会在没有准入进行中时给出），
  再在状态锁下对「同一代号且仍是空闲 Protected Offline」重新验证；通过才把这个写者交给释放（`Some(guard)`，不再传 `None`），写者一直持到释放工作线程结束，验证与释放之间不可能插入准入，
  工作线程读到的代号与发布票据仍是被验证的那一代。验证不通过则不登记释放、不启动探测。成功后的探测改用被验证的 `generation`，不再读当前代号。
- F2（主要）DHCP 目标只看注册表：精确还原即使实时应用失败也会把用户的注册表值写回，于是有效 DNS 仍是 198.18.0.2、注册表却是 1.1.1.1 的网卡被跳过，机器停在死解析器上；
  回退还信任应用返回值而不回读。改为注册表与有效 DNS（`GetAdaptersAddresses` 的有效列表，新增 `engine_effective_dns`）逐网卡合并判断（`adapter_needs_automatic_reset`），
  重置后用 `engine_any_loopback` 回读有效状态，只有没有网卡仍读作 Tono 目标才算成功，否则返回错误（应用返回值不再作证）；注册表和有效 DNS 都是用户的网卡不动。
  `still_on_loopback=true` 的硬拒绝（`dns/restore.rs`）与 WFP 武装期间的行为没有改，没有新增 53/853 放行；重置仍只在 WFP 移除之后。
- F3（主要）回环排除两头都错：(1) 快照里原值含用户自己的 127.0.0.1、但当前值仍是 198.18.0.2 的网卡整张被排除；(2) 快照没记录、用户自己用 127.0.0.1/::1 的网卡满足宽谓词，被清成 DHCP。
  现在把「当前在 Tono 专用端点（198.18.0.2）」与「记录在案的旧回环重定向」分开：198.18.0.2 无论注册表还是有效 DNS 出现都算 Tono 的；
  纯回环只对快照记录过的网卡、且当前值不再是用户保存的那个原值时才算 Tono 的；未记录网卡上的纯回环不作为 Tono 所有权证据，不动。
- F4（次要）文档：`--emergency-disarm` 命令行和开始菜单入口设 `TONO_UNINSTALL_DNS_LADDER=1`，本来就走卸载阶梯，被 `!uninstall_ladder_requested()` 排除；上文与
  `WIN-NRPT-KEPT-AFTER-EMERGENCY-DISARM` 已改为：新分支覆盖释放服务 `clean_up`（「恢复正常网络」按钮，#1569）和不带阶梯的更新执行器恢复。
- 复核剩余风险已处理：释放工作线程整个清理步骤的外层预算是 45 秒（`release/worker.rs`），而新回退腿原先用完整的 DNS 还原预算（40 秒）。
  现在 45 秒预算是 `EMERGENCY_DISARM_OUTER_BUDGET`（worker 直接引用，不会漂移），回退腿的预算为 `min(15 秒, 45 秒 − 已用时间 − 10 秒资源解析规则清扫)`，没有剩余时间则跳过并记录；
  被截断时随后的 `remove_tono_resolver_rule_within` 清扫仍删除 NRPT 规则。限制：若精确还原本身已耗尽 40 秒，回退腿没有时间，网卡留在 Tono 目标上，只靠清扫删 NRPT；该情形下返回的 DNS 错误和 `release_readback` 会如实报告 dns 残留。
- 工程与测试：除上列五例外新增 `windows_kill_switch::tests::the_emergency_fallback_leg_fits_inside_the_release_workers_budget`；DNS 测试桩新增有效 DNS（`set_effective_dns`）与「重置报告成功但没有落地」（`set_reset_does_not_land`）两个钩子。
- 验证：本机不跑 Windows 工作区的 cargo；修复提交由 hosted CI 判定，ci-gate 结果见 PR 正文。仍无真机验证。
