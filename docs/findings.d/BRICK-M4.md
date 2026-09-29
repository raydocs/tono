| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M4 | macOS 原生更新的 `observe()`/`prepare()` 看到任一服务上的任一 loopback 系统代理、没有 Proxies 协议的服务或含 `127.0.0.1` 的 DNS 列表就拒绝：attempt 卡住、gate 拒绝 arm/disarm，更新 Disconnect 与 `--emergency-disarm` 的待定路径也在碰 PF 前失败（ClashX、Surge、Proxyman、ProtonVPN、Shadowrocket 用户） | open | [#679](https://github.com/raydocs/tono/pull/679)（观察一半） | 中·已确认 | 本 PR 为观察一半：代理只在端口可能是 Core 的 mixed 入站端口（或端口读不出）时拒绝，没有 Proxies 协议不再拒绝；DNS 只在正好是 `[127.0.0.1]` 时拒绝。仍未解决：重启后（runtime config 不在）任何 loopback 代理仍拦（下一步：关掉它）；别家正好 `[127.0.0.1]` 的 DNS 仍拦；早先会话或旧版本在别的端口留下的 Tono 代理不归因；释放不依赖外部观察要等 stub PR；SystemConfiguration 接线未实机验证 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），opus MAC-5，codex 复核。
