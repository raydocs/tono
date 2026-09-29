| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M9 | macOS `/etc/pf.conf` 挂钩用 `load anchor "tono.killswitch" from "<Application Support>/Tono/pf.tono.conf"`（`KillSwitchPF.swift:367-372`），开机规则依赖一个可变的应用数据文件：文件被清理工具删掉时 `/etc/pf.conf` 加载失败，留着的旧文件开机会被加载 | open | 待开 | 中·推导 | 未修；方向：`/etc/pf.conf` 只写 `anchor "tono.killswitch"`，内容由 helper 用 `pfctl -a` 加载；brick 审计延后项 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），opus MAC-7，codex 复核；延后记录。
