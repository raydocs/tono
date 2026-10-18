## 2026-10-12 · Windows 健康失败释放被 Service 拒绝后 App 按监视周期重试
- 归属：SHIP_PLAN §2 item 10「连不上且无下一手」；Windows App（`apps/windows/app` 监视器）。
- 来源：从 PR #1590（head be3897725）拆出，仅 App 部分；分支 `claude/wifi-switch-win-app-retry`，PR #1599；尚未合 main。Service 一侧的 DHCP 回退仍留在 #1590。
- 缺陷修复：Service 拒绝自动放开（健康失败释放）后，App 原来只记一行日志、停在 Protected Offline；改为每个监视周期（2 s）重试同一个释放，带代数围栏（`claim_retry_release(state, generation)` 先取生命周期写锁，在状态锁下重新校验 `retry_session_owned`，再把写锁交给 `release_explicit_applying_narrow_with_guard`，探测使用捕获的代数）；会话被用户结束或被新连接/新代数取代即停止，成功后进入原有的无挡网探测。Service 的硬拒绝门不变。关联发现：`WIN-RELEASE-REFUSED-NO-RETRY`。
- 新增/优化：无。
- 工程与测试：确定性测试用 `futures::poll!`；`a_refused_health_release_is_retried_on_the_next_tick_and_then_starts_the_probe`（旧代码红：#1590 的运行 38283771592）、`a_retry_overtaken_by_a_connect_while_waiting_for_the_writer_claims_no_release`（红：运行 38289503639）。
- 验证：以上两个测试加本 PR 的 ci-gate（结果见 PR 正文）；独立 Codex 审查 #1590 的第 2–4 轮对本部分 I3/I7 通过、C4 覆盖，合并前仍需对本 diff 单独审查。未在本机运行 cargo。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无实机验证（换 Wi-Fi 热点 → 酒店/办公室场景）；Service 侧 DHCP 回退仍在 #1590 未合。不能声称已在真机放开屏障。

### 续记 2026-10-12 · Codex 复核第 1 轮
- 复核对象：PR #1599 head 475bbbb30；I1、I2、I4、I5、I6 通过，I3 一条严重：多个健康处理方（网络监视、pin 刷新）会加入同一次失败的释放，各自建 2 s 定时器，后一个循环可在同一会话同一拍启动第二个独立的 App 释放。
- 修复：`TonoInner.retry_owner`（`state.rs`）记录唯一存活的重试循环；`claim_health_retry(generation)` 在状态锁下领取，已有存活的同代循环则返回 `None`（第 2 轮起另加当前代守卫，见下），`settle_health_release` 在首个定时器之前领取，未领到的调用方直接返回。令牌由循环自己持有，循环结束或被中止即释放；`retire_connection_generation_as` 同时清空，后续代数/会话可重新领取。
- 测试：先红后绿——`two_callers_sharing_one_refused_release_start_one_retry`（两个调用方共享一次失败的释放，只允许一次重试；红：head b911a981 的 ci-gate）与 `the_retry_right_passes_to_a_later_generation_and_to_a_dead_loop`。
- 剩余限制：仍无实机验证；同代内的迟到调用方若在首个循环正常结束之后才到达，可重新领取（其 `retry_session_owned` 校验仍会在下一拍拦下不再空闲的会话）。

### 续记 2026-10-12 · Codex 复核第 2 轮
- 复核对象：head 577a47cb3；同代调用方已单飞，但跨代迟到的领取会覆盖槽位：旧代加入者尚未领取时 Connect 已把代数推进到 h，新代健康失败的 H1 领到 h 之后，旧代迟到者领 g 覆盖了 H1 的令牌，H2 再领 h 也成功，留下两个新代循环。
- 修复：`claim_health_retry` 在状态锁下、改动槽位之前，若 `generation != self.connect_generation` 直接返回 `None`（`state.rs`）；原有的同代存活令牌拒绝保留。因此该机制是「当前代守卫 + 同代单飞」，不是对任意代数各留一个循环。
- 测试：先红后绿——`a_late_claim_for_a_retired_generation_cannot_displace_the_current_owner`（红：head fdc680a3 的 ci-gate）；`the_retry_right_passes_to_a_later_generation_and_to_a_dead_loop` 重写为 `the_retry_right_passes_on_when_its_loop_is_gone_and_to_a_later_session`：持有原令牌，丢弃后同代可重新领取，再经真实的 retire 路径推进代数后新会话可领取。
- 剩余限制：同第 1 轮；仍无实机验证。

### 续记 2026-10-13 · 发现状态
- 源码已在 main `57776e805`（[#1599](https://github.com/raydocs/tono/pull/1599) 的合并提交）。`WIN-RELEASE-REFUSED-NO-RETRY` 从 `open` 改为 `fixed(57776e805)`。该状态只表示源码进 main。待实机不变：换 Wi-Fi（热点 → 酒店/办公室）后确认重试在 2 秒节拍内放行，且不绕过 Service 的 `still_on_loopback=true` 硬拒绝。
