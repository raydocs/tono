| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-AGENT-TIMER-BOOT | 出口 exit-agent 的 systemd timer 与 service 不在仓库，部署单元是否有开机基准（如 OnBootSec）未知；2026-09-24 部署时四台停摆 6–14 分钟 | open | [#1711](https://github.com/raydocs/tono/pull/1711)（准备性诊断） | 中·实机 | 需在每台节点只读检查 `systemctl cat tono-exit-agent.timer tono-exit-agent.service` 并做冷启动首轮确认；确认后版本化完整 unit |

Codex 核验 NEEDS-HARDWARE：「重启后所有用户身份消失」不成立（当时的静态配置含用户身份）。记录于 #1386。

2026-10-22 仓库诊断（main `d1232520a742b3e747f7b9a228361d696f24a172`）：
未找到完整 unit 或生成/部署它们的脚本；metering enable 脚本只修改 Xray，不能作为 agent 的部署合同。
现有 rollout 只记载沿用 Westwood unit/timer（每分钟），无法确认有无开机基准，亦无法安全重建运行用户、启动参数、依赖和沙箱。
见 [只读证据命令及后续验收条件](../../services/exit-agent/TIMER_BOOT_DIAGNOSIS.md)。
本轮无 SSH/生产访问、无 unit/运行逻辑改动、无冷启动验证；状态保持 `open`，不把缺少文件当作运行时 RED。
