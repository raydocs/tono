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
  - Service：非卸载的 `emergency_disarm_with`（`--emergency-disarm`、开始菜单「恢复网络」、释放服务 `clean_up`）在 `restore_protected` 适配器证明失败时，WFP 移除后
    仍在 198.18.0.2/回环上的网卡没人处理，解析全部去一个没人应答的地址。现在 WFP 与意图清理之后，对这些网卡做与卸载阶梯第 2 档相同的重置（自动/DHCP，双栈），
    再调用 `restore_resolver_policy`（NRPT 与 Encrypted DNS）；快照文件保留，之后仍可精确还原；原 DNS 错误照旧返回。只重置读作 Tono 目标的网卡，原值本来就是回环的网卡不动。
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
