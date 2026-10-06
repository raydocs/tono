| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-AGENT-TIMER-BOOT | 出口 exit-agent 的 systemd timer 与 service 不在仓库，部署单元是否有开机基准（如 OnBootSec）未知；2026-09-24 部署时四台停摆 6–14 分钟 | open | 待开 | 中·实机 | 需在每台节点只读检查 `systemctl cat tono-exit-agent.timer tono-exit-agent.service` 并做冷启动首轮确认；确认后版本化完整 unit |

Codex 核验 NEEDS-HARDWARE：「重启后所有用户身份消失」不成立（当时的静态配置含用户身份）。记录于 #1386。
