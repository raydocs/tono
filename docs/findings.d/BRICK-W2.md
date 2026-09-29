| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W2 | Windows 卸载程序置 $TonoManualMutated 后、第一个改动之前中止（「Tono 正在运行」处取消、卸载助手缺失）会留下手动租约；持有者退出后租约仍挡释放、更新 Disconnect 与修复，重启后 WFP 重新武装而 Core 恢复被跳过 | in-PR | #681（Service 半边）；#680（NSIS 半边，PLAN-win-boot-uninstall） | 中·推导（跨厂商核实；未实机） | Service 半边：持有者确认死亡（PID 不存在或已退出，或同 PID 创建时间不同；读不到即视为活着）时，释放准入与 App 释放前的更新 Status 探测放行；连接、其余更新请求、修复与启动恢复仍被挡，Service 不清除租约，要等下一次安装或卸载程序替换。NSIS 半边见 #680 |

来源：2026-09-29 Windows 变砖排查；Service 半边按 PLAN-win-release-min rev 2 §2.2 实现。
相关且未改：WIN-UNINST-LEASE-WINDOW、TW-anthropic-6。
