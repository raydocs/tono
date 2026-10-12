## 2026-10-12 · Windows 健康失败释放被 Service 拒绝后 App 按监视周期重试
- 归属：SHIP_PLAN §2 item 10「连不上且无下一手」；Windows App（`apps/windows/app` 监视器）。
- 来源：从 PR #1590（head be3897725）拆出，仅 App 部分；分支 `claude/wifi-switch-win-app-retry`，PR #1599；尚未合 main。Service 一侧的 DHCP 回退仍留在 #1590。
- 缺陷修复：Service 拒绝自动放开（健康失败释放）后，App 原来只记一行日志、停在 Protected Offline；改为每个监视周期（2 s）重试同一个释放，带代数围栏（`claim_retry_release(state, generation)` 先取生命周期写锁，在状态锁下重新校验 `retry_session_owned`，再把写锁交给 `release_explicit_applying_narrow_with_guard`，探测使用捕获的代数）；会话被用户结束或被新连接/新代数取代即停止，成功后进入原有的无挡网探测。Service 的硬拒绝门不变。关联发现：`WIN-RELEASE-REFUSED-NO-RETRY`。
- 新增/优化：无。
- 工程与测试：确定性测试用 `futures::poll!`；`a_refused_health_release_is_retried_on_the_next_tick_and_then_starts_the_probe`（旧代码红：#1590 的运行 38283771592）、`a_retry_overtaken_by_a_connect_while_waiting_for_the_writer_claims_no_release`（红：运行 38289503639）。
- 验证：以上两个测试加本 PR 的 ci-gate（结果见 PR 正文）；独立 Codex 审查 #1590 的第 2–4 轮对本部分 I3/I7 通过、C4 覆盖，合并前仍需对本 diff 单独审查。未在本机运行 cargo。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无实机验证（换 Wi-Fi 热点 → 酒店/办公室场景）；Service 侧 DHCP 回退仍在 #1590 未合。不能声称已在真机放开屏障。
