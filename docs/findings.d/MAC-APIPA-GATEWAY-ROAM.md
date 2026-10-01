| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-APIPA-GATEWAY-ROAM | DHCP/APIPA 期间 IPv4 网关变成 169.254 会被当成上行迁移，已连接会话拆隧道并保持 Kill Switch | in-PR | #835 | 中·推导 | 分类修正；未在真机上制造 169.254 网关 |

`NetworkUplinkSnapshot.usableIPv4Gateway` 只丢掉 `0.0.0.0`。地址侧已经把 `169.254/16` 视为空窗（`testAPIPADuringRenewalIsNotANewNetwork`），网关侧没有。`classify` 在两个具体网关不等时直接返回 `.moved`，连接中的核对和一分钟审计都会 `disconnect(releaseKillSwitch: false)` 并重连。
