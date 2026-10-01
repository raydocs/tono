## 2026-10-01 · Windows 冷连接预算计入 Core 准备和住宅浏览器 DNS
- 归属：SHIP_PLAN §2 第 10 项（连接事务误超时）；影响 Windows 首次连接时钟。
- 来源：main `5ba113d2` → `e252da98`；分支 `hunt/grok-winapp-connect-budget-2a89`；PR #884；未合 main。
- 缺陷修复：冷连接最坏路径现在计入 PrepareCoreStart 65s 和住宅浏览器 Secure DNS 5s。合计 278s，事务时钟 310s，仍留约 32s 余量。超时仍按既有失败路径释放，不新增断网。关联 `WIN-CONNECT-BUDGET-PREPARE`。
- 新增/优化：无。
- 工程与测试：`connect_budget_covers_a_cold_first_connect` 核对两条新腿不低于各自常量。
- 验证：本机 rustc 1.83 无法编译 edition 2024，未运行 `cargo test`。hosted Windows CI 执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware。未在真机上把 Core 准备和浏览器 DNS 扫描拖到各自上限。
