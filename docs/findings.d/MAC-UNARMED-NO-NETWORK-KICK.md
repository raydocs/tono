| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UNARMED-NO-NETWORK-KICK | macOS 自动放行后，「未上锁重连」循环不响应网络变化：断网久了退避到 120 秒一探，网络恢复或开盖后最长还要再等约 2 分钟才重新连接 | in-PR | [#1346](https://github.com/raydocs/tono/pull/1346) | 中·推导 | 只在循环仍属于当前这一代、且仍会探测时才重启（已上锁、已暂停、意外重启后等用户操作、待更新时不动）；重启后到首探之间的后续网络变化不再推后首探；循环本身现在也遵守「意外重启后只由用户重连」；未在 Mac 实机上断网再恢复验证 |

依据：`apps/macos/Tono/Services/AppState.swift` 的 `handleSystemNetworkChange` 在未连接时只处理 PF 仍上锁的情况（踢一次受保护重连），未上锁就直接返回。自动放行（决定 031）后由 `scheduleUnarmedReconnect` 的循环按 2/5/15/30/60/120 秒退避做 TCP 探测，探到可达才重新连接；断网超过约 2 分钟后循环停在 120 秒一档。此时 Wi-Fi 回来或合盖换了网络再开盖，系统的网络变化通知不会叫醒这个循环（开盖时到期的那一探又常常赶在 Wi-Fi 关联之前，再输一档），用户在原网络上没有 Tono，直到下一探或自己点连接。Windows 的同一循环在等待中会被物理网络变化叫醒（`connection/unarmed_probe.rs` 的 `sleep_until`），macOS 没有对应处理。2026-10-02 读代码发现。
