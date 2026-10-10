| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| A17W-STOPPED-HOP-STICKS | Windows A17：自动 hy2 尝试在连上之前被停止（断开、退出、登出、更新、连接超时取代）时 `note_hy2_outcome` 对 `Stale` 直接返回，记住的 hy2 选择和 TCP 失败计数都不变；在丢 UDP 的网络上 hy2 尝试会一直挂到用户放弃，于是 24 h 内每次连接都再拨 hy2 | in-PR | [#1532](https://github.com/raydocs/tono/pull/1532) | 中·推导（代码阅读，仅 `hy2AutoSwitch` 开时） | 修复后被停止的自动 hy2 尝试清掉该节点的记忆和计数（不加退避，决定 088），下次拨 Reality；装甲下的原地重连（`live_dial`）不变；仅开关开的账号受影响 |
