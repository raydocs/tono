| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-HIDDEN-WINDOW-IDLE | Windows 主窗口关到托盘与关闭的托盘 flyout 只隐藏窗口，WebView2 页面仍报 visible，流量 socket、15–30 s 轮询与 1 s 时钟在隐藏窗口里一直运行；另有无人读取的流量历史 Worker | in-PR | 本 PR | 低·推导 | 隐藏后 `document.visibilityState` 不变依据 tauri-runtime-wry 2.12.1 源码（`WindowMessage::Hide` 只调 `window.set_visible(false)`，不调 WebView2 `SetIsVisible`）与 SeaScene 注释，未在实机观察；耗电改善未实测 |

模拟测量（Linux orb，Chromium 156，存根 Tauri IPC，Core 每秒一帧流量，窗口报隐藏、文档仍 visible），每分钟：
主窗口已连接隐藏 IPC 8 → 0、主线程任务 270–469 → 54–68 ms、布局 60 → 0；托盘 flyout 隐藏 247–249 → 33 ms、布局 60 → 0；
Protected Offline 隐藏 IPC 38 → 0。窗口可见时行为不变（IPC 44–46/min）。
