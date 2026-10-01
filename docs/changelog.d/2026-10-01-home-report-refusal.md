## 2026-10-01 · home-agent 拒绝单条用量后继续投递

- 归属：ops 计划，home-agent 用量上报。不改客户隧道。
- 来源：`origin/main`；分支 `cursor/home-report-refusal-2c38`。仅源码，未合 main。
- 缺陷修复：控制面永久拒绝一条报告时，整条待发队列不再停住。该条被丢弃，后面的账号继续投递。关联 HOME-AGENT-REPORT-400-WEDGE。
- 新增/优化：无。
- 工程与测试：`test_a_refused_report_does_not_block_the_next_account`。先在未修改的 `deliver_pending` 上失败（400 直接抛出），改后通过。
- 验证：本机 `python3 -m unittest services.home-agent.test_report_example`，25 tests OK。
- 候选/发布：无新包。
- 剩余限制：被拒绝账号这一次的增量不重发，因为 peer 基线已经记下这次观测。5xx 和超时仍整批留在队列。home-agent 上报器尚未部署。
