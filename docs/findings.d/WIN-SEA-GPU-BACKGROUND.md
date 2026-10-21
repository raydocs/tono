| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SEA-GPU-BACKGROUND | Windows 海景在窗口后台、最小化、收托盘时仍在渲染（WebView2 页面仍算可见），登录页和引导页还多渲染一层看不见的背景海景，集显被持续占用 | fixed(fcae825ee) | [#1707](https://github.com/raydocs/tono/pull/1707) | 中·实测 | 待实机：Intel 集显 Windows 上测量后台 GPU 占用的下降；前台动效开销不在本修复范围 |

客户 0.0.75 实测：Tono 在 Task Manager 后面时，WebView2 GPU 进程占用 Intel 集显 3D 引擎 59–86%（12 秒采样，平均 72%，峰值 95%）。
