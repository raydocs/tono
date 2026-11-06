## 2026-10-27 · Windows：关到托盘的窗口不再轮询、不再收流量帧
- 归属：无发布门（性能/省电，排下一发；不属 SHIP_PLAN §2 第 10 条冻结修复）；Windows 前端。
- 来源：基线 origin/main `71a007eea`；分支 `amp/windows-hidden-window-idle`。
- 缺陷修复：WIN-HIDDEN-WINDOW-IDLE。主窗口关到托盘、托盘 flyout 关闭后只是隐藏，WebView2 页面仍报 visible；首页与托盘面板的流量 socket、目录/加密 DNS/线路偏好/服务前置检查轮询、连接进度 2 s 轮询以及 1 s/5 s/30 s 时钟改为跟随窗口可见（`useTonoStatus().visible` / `useVisibility`，与已有的状态 5 s 轮询同一口径），窗口重新显示时立即读一次。
- 新增/优化：删除无人读取的流量历史采样 Worker（`use-traffic-monitor.ts`、`traffic-monitor-worker.ts`、`traffic-sampler.ts`）。
- 工程与测试：`dashboard.test.tsx` › 隐藏到托盘时不保留流量 socket、重新显示时打开。
- 验证：见 PR 验证评论。
- 候选/发布：仅源码，无新候选。
- 剩余限制：数字来自 Linux orb 的存根 IPC 模拟，不是实机 CPU 或耗电；隐藏后 visibility 不变依据 tauri-runtime-wry 源码，未在真实 Windows 上观察。连接、kill switch、WFP 与 Service 路径未改。
