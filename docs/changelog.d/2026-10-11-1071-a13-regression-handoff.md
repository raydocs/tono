## 2026-10-11 · #1071 纳入 A13/092 的生产路径回归交接
- 归属：SHIP_PLAN G1/G2；#1071 helper replacement，#1307与发布不在范围。
- 来源：main [134e126a](https://github.com/raydocs/tono/commit/134e126a12e8c8ace0aa501fc8dd55cea6fbbb5a) 与 A13 [f631a083](https://github.com/raydocs/tono/commit/f631a083b5b25ca14c3820e558f82110accd6f09)；分支 `docs/1071-a13-regression-handoff`，仅交接文档。
- 缺陷修复：本 PR 无产品修改；fresh fault=false 的 abandoned upgrade仍完整disarm，协调者已决定由#1504 owner纳入092，不另写自动放普通联网/保窄AI的fix。
- 新增/优化：[证据与单条两阶段回归设计](../reports/ISSUE_1071_A13_REGRESSION_HANDOFF_2026-10-11.md)：失败无release/保isArmed及DNS快照，然后同一状态用户明确Restore成功；补核release API从4.52.17才有。
- 工程与测试：沿用CI38106694496/job114373950961，实际checkout dd47785合成f631a083与134e126a；既有no-fault生产路径XCTest实际PASS且期待DNS=1/release=1，不能当新092测试PASS。708 tests/1skip/0failure。
- 验证：源码/历史/命名测试日志已读；新回归代码仅设计，未编译/未执行，RED/GREEN和实际PF/DNS/取消故障仍由A13 owner及设备测试者完成。docs无需重跑产品测试。
- 候选/发布：无新包、无helper版本修改、无部署发布；不写A13独占源码/测试/决定文件，不创建线程/worker，不改变release协议或特权面。
- 剩余限制：#1071保持open，实际修复与精确head CI/唯一Sol签核属#1504；docs交付不是实现/设备验收回执。
