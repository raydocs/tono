| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-HEAL-HY2-SKIPS-OWN-REALITY | Windows 自愈：手选的 ` · hy2` 行在丢 UDP 的网络上失败时，错误文本通常是超时（归为 `Tcp`）而不含 quic/hysteria，`repair_rank` 只在端口、SNI 或地址不同时才把同节点 Reality 排进来；目录里 hy2 块与 Reality 块三者相同，于是自愈跳过本节点的 Reality，直接换到同地区另一节点 | in-PR | 待开（`amp/win-heal-hy2-to-reality`） | 中·已确认（tono-core 回归测试在旧规则下得到「Los Angeles · Harbor」） | 修复后 hy2 拨号的任何非鉴权失败都先回本节点 Reality（`DialChange::Transport`）；自愈结果仍只用于下一次手动连接（DialBeforeArm）；无隧道探测（`unarmed_probe`）仍不优先本节点 Reality（既有行为，未改） |
