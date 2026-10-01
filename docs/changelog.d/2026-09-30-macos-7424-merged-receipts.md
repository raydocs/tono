## 2026-09-30 · macOS 7424 修复合入收据
- 归属：SHIP_PLAN §2 item 10；仅维护已合入的缺陷与验证记录。
- 来源：main `bf163df0`；不改变任何产品源码、测试、发布门或本机状态。
- 缺陷修复：无新产品修复；M7424-native-disconnect-reading、R677-codex-F1、MAC-LOGIN-INVENTORY及M7424-continuity-public-direct分别记入实际main合并SHA，保留未验收设备/P0边界。
- 新增/优化：无。
- 工程与测试：记录准确source/head的独立Codex high审查、实跑hosted red与四job green；不让先前pending或子代理sandbox错误冒充当前状态。
- 验证：本地git diff --check和records findings/changelog读取均成功；docs-only无新增native编译要求。
- 候选/发布：仅记录，未构建/安装客户包、未发布。
- 剩余限制：首次kernel panic根因、实机剪贴板和安装验收均未证明；已记录的open项不因此关闭。
