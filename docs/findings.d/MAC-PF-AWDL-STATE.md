| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PF-AWDL-STATE | macOS PF 的六条 Continuity 放行（awdl0/llw0/bridge100 进出）用 `keep state (if-bound)`，在 macOS 按需创建、销毁的接口上保留绑定接口的状态条目 | in-PR | [#675](https://github.com/raydocs/tono/pull/675) | 中·推导 | 改为 `no state`，放行集合不变；是否就是通用剪贴板 panic 的触发点未证实；`no state` 形式的 pfctl 解析只由 CI 的 root 自测证明；未实机验证 |

所有者决定（2026-09-27）：实机复现前先在代码里加固。依据：这六条是规则集中在这些接口上最先能命中的规则（前面只有 lo0 两条，
都是 `quick`），进、出各有一条放行，所以去掉状态后 mDNS、link-local、NDP、LAN 流量在这些接口上照样放行，只是不再建状态。
`no state label` 的写法与已有的入站 `tono-dhcp` 放行相同。在我们这边能想到的通用剪贴板 panic 触发点里，这一处最可疑，但没有 panic
报告，因果未证实。
