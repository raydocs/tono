| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-BOOT-TUNNEL-PASS | macOS helper 从磁盘重装 PF（daemon 启动、`status()` 自愈、supervisor 修复）时按 `killswitch.state` 原样渲染，连同上次会话的 utun199，开机时（登录前、没有 TUN）就装上只应在隧道存在时出现的 Continuity（awdl0/llw0/bridge100）、mDNS、LAN、link-local、DHCP、NDP 放行 | in-PR | [#675](https://github.com/raydocs/tono/pull/675) | 中·推导 | 三条路径都只渲染此刻存在的 utun，磁盘状态不改写；自测只覆盖共用的 `restorableState` 过滤（路径本身要 root/pfctl）；与客户 panic 循环的关系未证实；未实机验证 |

客户现场（2026-09-27，含 6226b604 之前全部改动的 macOS 候选）：连接中用通用剪贴板（iPhone → Mac）后内核 panic，之后每次登录约 2 秒、
安全模式下也反复 panic，暂无 panic 报告。读源码确认：`restoreAtLaunch()`（daemon 启动时由 init 调用）对持久化状态直接
`writeRules` + `ensureAnchorLoaded(flushStates: true)`，而 `KillSwitchPF.renderRules` 的注释写明无隧道时不得保留这些旁路放行。
修复：`restorableState` 用 `if_nametoindex` 过滤 `tunnelInterfaces`，开机时为空，渲染出无隧道形态；只减少放行。
`status()` 自愈与 supervisor 修复同样的问题由 #675 评审发现（codex:F1 = opus:F2），同 PR 修复。
