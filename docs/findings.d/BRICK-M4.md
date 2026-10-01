| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M4 | macOS 原生更新的 `observe()`/`prepare()` 看到任一服务上的任一 loopback 系统代理、没有 Proxies 协议的服务或含 `127.0.0.1` 的 DNS 列表就拒绝：attempt 卡住、gate 拒绝 arm/disarm，更新 Disconnect 与 `--emergency-disarm` 的待定路径也在碰 PF 前失败（ClashX、Surge、Proxyman、ProtonVPN、Shadowrocket 用户） | in-PR | [#712](https://github.com/raydocs/tono/pull/712) | 中·已确认 | #679 的观察一半保留：未知端口的 loopback 代理仍拒绝开始更新，不把别人的代理关掉。本 PR：`disconnect` 在 prepare 失败后仍释放 PF。更新准入本身仍会被别家代理或正好 `[127.0.0.1]` 的 DNS 拦住。SystemConfiguration 未实机 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），opus MAC-5，codex 复核。
