| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-BOOT-DNS-ORPHAN | macOS helper 重启后 Core 已停，DNS 快照仍把系统解析留在 `127.0.0.1`；没有快照时启动不清别人的 loopback DNS。安全模式不跑 helper，这条启动恢复也不会发生 | in-PR | 待开 | 中·已确认 | Core 已停且快照存在时恢复 DNS，不再因为「保护意图在而 PF 未生效」留下死解析。没有快照则不扫别人的 `127.0.0.1`（BRICK-M12）。安全模式仍需手动 `networksetup -setdnsservers <服务> Empty`。未实机 |

2026-09-30：断开路径先恢复 DNS 再 disarm。崩溃或 helper 重启落在这两步之间时，下次正常启动若 Core 已停且快照还在，就恢复解析。
