## 2026-09-30 · macOS 流量弹窗改为「本次连接」
- 归属：界面/零配置改进（2026-09-30 已批准的 UI 提案第 4 项）；不是 SHIP_PLAN §2 第 10 项修复，G4 冻结期间不合入。影响 macOS 首页「实时流量」卡片的弹窗。
- 来源：基线 main `d2363002` → 分支 `cursor/macos-traffic-session-label-b9f5`；未合 main。
- 缺陷修复：弹窗原来有「今天 / 本月」两列，但数据只是核心本次会话的累计值（断开即清零），「本月」还混入了应用分流账本的总量，填进「上传」一行。这两列都不是真的按日、按月统计 → 改为只显示「本次连接」的上传、下载、合计，并注明「断开后清零。」。原来的英文大写标题（DATA USAGE / DIRECTION / TODAY / THIS MONTH）目录里没有中文，中文用户看到的是英文；新文案都有中文翻译。
- 新增/优化：无。
- 工程与测试：`DataUsageSummaryViewTests` 改用 `session`；新增一个 XCTest，确认弹窗只取 `trafficStats` 的本次累计值。
- 验证：macOS XCTest 未运行（此主机无 Xcode），留给托管 CI。只读取已有计数，不改连接、断开或网络代码。
- 候选/发布：仅源码，无新候选。
- 剩余限制：`DashboardView.swift` 里的提示文案「View data usage summary」没改，因为那个文件与 #706 重叠。
