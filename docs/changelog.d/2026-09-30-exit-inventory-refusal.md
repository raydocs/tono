## 2026-09-30 · 出口代理拒绝轮次仍记住已安装客户端
- 归属：ops 计划（计量与吊销），不是 SHIP_PLAN 发版门。影响 exit-agent。
- 来源：基线 `50bbbbf0` → 本分支；[#838](https://github.com/raydocs/tono/pull/838)，Fixes #810。未合 main。
- 缺陷修复：对账已经增删客户端之后，若后续添加失败、计数读失败、名册缓存无法清除、source 不匹配或待报时钟超窗，持久库存仍停在上一轮。没有 `inbounduser` 的节点下一轮无法撤掉刚装上、随后被名册去掉的客户端。现在这些拒绝只补写已知的 `installedClients`，不确认名册，也不推进用量。
- 新增/优化：无。未知库存（`None`）仍然不写成空列表。
- 工程与测试：`test_a_counter_read_failure_keeps_a_new_client_removable_without_a_live_listing`、`test_a_later_add_failure_keeps_clients_already_accepted`。修复前两条都失败，修复后 `python3 services/exit-agent/test_reconcile_and_report.py` 101 项通过。
- 验证：Linux 上跑上述 unittest，101 tests OK。未在出口节点部署。
- 候选/发布：仅源码，无新候选。
- 剩余限制：下一轮若能列出 inbound，本来就会按实况撤除；本修复覆盖的是列表不可用时的持久库存。xray 在计数读取期间重启导致的一代不明，仍不把那一轮当成可确认的名册。
