| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PF-NO-DHCP-WITHOUT-TUNNEL | Mac PF 的 `tono-dhcp` 与 `tono-ndp` 只在有隧道时渲染，无隧道规则集（bootstrap、preserve、reassert、紧急阻断）没有 DHCP/NDP 放行，换 Wi‑Fi 后可能拿不到租约，只能卸载才能上网 | open | [#1591](https://github.com/raydocs/tono/pull/1591) | 高·推导 | 待实机：换 Wi‑Fi 后能否取得租约；DHCPv6 与单播续租在无隧道时仍被拦 |

SHIP_PLAN §2 item 10「连不上且无下一手」。修复：两组放行移出 `renderRules` 的隧道分支，每份规则集都有（决策 097）。根因推导自 `KillSwitchPF.swift` 与 `NetworkUplinkSnapshot.classify`，未在真机复现。
