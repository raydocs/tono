| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-TUNNELED-NDP-KEEP-STATE | 有隧道规则集里的 `tono-ndp` 仍是 `keep state (if-bound)`；Apple PF 对非错误 ICMPv6 的状态键不含类型，与 #1591 第 1 轮 F1 同一问题 | open | [#1591](https://github.com/raydocs/tono/pull/1591) 审查记录 | 中·推导 | 所有者决定；本 PR 未改 |

既有行为，本 PR 只把无隧道规则集改成 `no state`，有隧道文本保持逐字节不变。建议修法：有隧道规则集也让两个方向都用 `no state`；这会改变有隧道规则集的字节，需要单独审查（包括 `localNetworkOnExpected` 等整串断言和 helper 版本）。
