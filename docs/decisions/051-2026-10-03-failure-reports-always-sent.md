## 2026-10-03 · 连接失败和保护丢失的上报要不要受「保护快照 / 诊断时间线」开关控制

- Status: provisional
- Chosen: 不受控制，两端一致。连接失败的分类记录（阶段、错误码、节点、版本）和保护丢失事件（`TONO_NETWORK_LOSS`、`TONO_FAIL_OPEN`、`TONO_WATCHDOG_RESTORE`、`TONO_KILL_SWITCH_STUCK`、`TONO_RESTORE_NETWORK`、`TONO_CRASH_WHILE_PROTECTED`）在所有正式版始终发送；开关只控制定期时间线和失败报告里的自由文本（错误原文、Core 日志行）。关闭开关时丢掉本机队列里可能带自由文本的时间线和失败正文，保护丢失事件保留。内测版的失败上报退出选项保留（测试噪音）。被拒的选项：开关关闭后一律不发（[决策 050](050-2026-10-02-macos-loss-reports-respect-opt-out.md) 的做法）。本条取代 050 的「不上传」部分；默认开启和 v3 一次性重开不变。
- 所有者原话（2026-10-03，会话内）：「我觉得 mac 和 win 现在一定自动要发故障报告 不然我真的很难去 debug 没有真实用户测试」。本文件状态仍是 provisional，因为只有所有者改成 owner。
- Why stricter: 上报内容不扩大：始终发送的部分只有阶段、错误码、节点名（非目录标签一律写 `unselected`）、应用和系统版本；网站名、页面内容、错误原文、Core 日志仍要开关开着。设置文案改成如实说明「始终上报」，不再写「关闭后停止这些上传」。代价是用户不能关掉这部分上报；隐私政策文本要和这个一致（所有者自查）。
- Applied in: macOS `fix/macos-failure-reports-always-20261003`；Windows `feat/windows-diagnostics-default-on-20261003`（移植 #724）。
