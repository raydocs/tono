## 2026-09-30 · macOS update metadata whole-transfer deadline
- 归属：SHIP_PLAN §2 item 10；macOS native update reliability.
- 来源：baseline `b1825a3a`；branch `hunt/sol-r3mac-update-metadata-deadline`，未合 main。
- 缺陷修复：元数据持续滴流会重置空闲超时，使检查更新长时间不可用；现在清单和签名各有 30 秒整体传输截止。关联 MAC-UPDATE-METADATA-DEADLINE。
- 新增/优化：无；包下载、签名和 helper 保护行为保持原契约。
- 工程与测试：一个真实 loopback TCP 滴流 XCTest，持续进展仍须整体超时；不使用 URLProtocol 代替系统计时器，不修改产品 ATS 例外。
- 验证：Apple 官方计时器文档确认原错误；`git diff --check` 本地通过。Linux 无 Swift / Xcode，未编译或执行 XCTest，待 hosted macOS CI。
- 候选/发布：仅源码，无新候选，未部署或发布。
- 剩余限制：P2 更新入口可用性，不声称原问题会切断网络或挂起机器；无实机验证。
