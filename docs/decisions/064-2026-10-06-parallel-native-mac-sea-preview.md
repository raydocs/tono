## 2026-10-06 · Mac 并行开发的外观边界
- Status: provisional
- Owner evidence: 本轮 owner 写“嗯开始做 然后同步开 subagent 开发 mac 的”。这是并行开发的指令，不是外观、实机或发布验收。
- Chosen: Windows 按 ROUND-3 的十个 stacked drafts 顺序推进；Mac 在独立工作树同步做原生 SwiftUI、默认关闭的海景预览。暂沿用现有原生侧栏/系统字体/窗口交互，不将 Windows 胶囊和控件尺寸逐像素移植；这项 Mac 视觉解释是 agent 的可逆 provisional 选择，不冒充 owner 批准。
- Why stricter: 只改展示层和设备本地外观设置；保留所有连接、恢复、账户、支持及菜单栏操作；未确认/阻断不显示成功日景；不更改 Helper/Core/PF、版本或发布 trust，不开新依赖或持续帧循环。新图标仍须先看 sheet 再接线。
- Applied in: [Mac draft #1405](https://github.com/raydocs/tono/pull/1405)；[Windows draft #1406](https://github.com/raydocs/tono/pull/1406)、[#1407](https://github.com/raydocs/tono/pull/1407)。源码与候选、验收、发布分开；0.0.75 的新源码需要新候选/G1/G2 证据。
