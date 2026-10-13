## 2026-10-13 · Windows Service Stop 等待已在进行的 WFP 移除
- 归属：SHIP_PLAN §2 item 10；Windows Service（`apps/windows/service`，WFP 释放 / 生命周期）。
- 来源：基线 origin/main → 分支 `claude/win-stop-wfp-wait`；Refs/Closes #1284；决定 [117](../decisions/117-2026-10-13-service-stop-waits-for-inflight-wfp-removal.md)（provisional）。
- 缺陷修复：SCM Stop 等满 60 s 后丢弃运行时，而释放仍在 WFP 移除里：可能是另一任务（如 StartClash 失败回滚）持有的，也可能是 Stop 自己的（DNS 40 s + Core 停止 + WFP 25 s 预算合计可超出 Stop 窗口），事务被中止，非严格机器保持整机阻断直到下次 Service 启动。改后：Stop 窗口结束后，若有 `remove all filters` 正在引擎内，最多再等 30 s 等它返回，再最多 5 s 等该释放写完 tombstone，然后才丢弃运行时；不新增、不跳过、不撤销任何释放；超时仍未返回则与旧行为相同，释放的收尾（tombstone）可能随被取消的 Stop 一并丢失，由下次 Service 启动的既有恢复释放（既有测试 `restore_on_service_start` 路径：非严格、Core 未运行的 wanted 记录启动即释放）。
- 新增/优化：无。
- 工程与测试：`stop_waits_for_an_in_flight_wfp_removal_before_the_runtime_is_dropped`。
- 验证：见 PR 正文 `## Verification`。未在真机强制 DNS+WFP 同时接近超时。
- 候选/发布：仅源码，无新候选。
- 剩余限制：若释放仍在 DNS 阶段时 Stop 窗口已结束（需 Stop 前开始的释放 DNS 超过 60 s，受 40 s DNS 上限排除），运行时仍被丢弃；BFE 卡死时 30 s 后同旧行为。待实机。
