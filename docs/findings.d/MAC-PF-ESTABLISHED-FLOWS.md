| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PF-ESTABLISHED-FLOWS | Kill Switch 武装（或整表清状态）时，规则本来允许的已建立 TCP 连接（lo0、局域网、链路本地）被静默丢弃：有状态规则默认 `flags S/SA`，中途的包建不了状态，落到 `block drop out` | open | 待开 | 中·推导 | 未修。表现是开 TUN 后局域网长连接（接力/通用剪贴板的 companion-link、投屏流、SMB、SSH）卡到各自超时；每次整表清状态（首次武装、唤醒）重复一次 |

依据：`man pf.conf`：「For stateful connections, the default is flags S/SA … only the initial SYN packet of a TCP handshake will create a state」。`awdl0`/`llw0`/`bridge100` 的放行已是 `no state`，不受影响；`tono-loopback`、`tono-lan`、`tono-linklocal` 仍是 `keep state (if-bound)`。归档报告 `docs/archive/reports/TONO_MAC_WECHAT_ULTRA_REVIEW_2026-08-03.md` 第 114 行确认过同一语义，当时只收窄了清状态的范围（`stateDisposal`），没有处理武装前就存在的连接。
