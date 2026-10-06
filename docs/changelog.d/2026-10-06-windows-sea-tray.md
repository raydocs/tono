## 2026-10-06 · Windows 新外观 PR 7：托盘预览
- 归属：`docs/SHIP_PLAN.md` 0.0.75 UI，ROUND-3 §9；默认关闭，stacked on #1409。
- 来源：`8d05d2d1` → 本 PR head，`codex/windows-ui-pr7-20261006`；未合 main。
- 缺陷修复：无已发布产品缺陷；新外观状态通过既有 live protection 证据，不因 FSM connected 单独宣称保护。
- 新增/优化：320×232静态托盘、状态/线路/阶段或延迟、quiet断开/取消、primary连接/立即重试、最多两个新鲜推荐/收藏/近期快速选择、完整选线折叠列表、AI及仅live吞吐、备用通道、错误、打开/退出均可访问。快速选择复用原pickServer + idle admission helper；旧外观原界面/动作不变。
- 工程与测试：native仍以280×176创建旧外观。新增仅真正tray-flyout窗口可用的非特权外观尺寸命令；新常量320×232，开关关闭恢复原尺寸，保留原图标anchor/DPI/边缘clamp算法，读取真实逻辑尺寸重新定位。IPC外观写入串行，不改capabilities、服务、连接或WFP。纯尺寸回归待hosted Windows；前端快速选择一次及取消通过原Disconnect各一回归。
- 图标：`src/dev/sea-shell/tray-icons.svg`仅1×轻/深taskbar图稿，16/20/24/32；未接入真实托盘，原图标保留。owner尚未批准；与PR10图稿一起展示后才能wire。
- 验证：最终前端/CI和模拟截图在PR comment；MacBook不运行native cargo。Windows真实taskbar四边/多DPI/首次显示/开关切换仍待硬件。
- 候选/发布：仅源码，无新包、签名、安装或客户发布。
- 剩余限制：尺寸/窗口生命周期相关独立覆盖及Windows CI/hardware须在合并前完整记录；新图标未批准、未接线。没有后端连接时长数据就不伪造时长，显示真实阶段/延迟；quick rows仅有现有scoped记录时出现。
