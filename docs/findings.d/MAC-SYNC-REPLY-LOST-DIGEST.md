| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-SYNC-REPLY-LOST-DIGEST | macOS helper 已经按 `/core/sync` 换了 Core 进程但应答丢失时，App 记的「已安装文档摘要」还是上一份；之后相同配置的完整 reload 判定「没有变化」跳过 sync，实际运行的是另一份文档 | open | [#1334](https://github.com/raydocs/tono/pull/1334) 评审发现，未修 | 中·推导 | main 上已有；#1334 的 fake-IP 保持原字节和跳过槽位都依据这条记录，记录旧时依据也旧；修它要让失败的 sync 之后摘要变为未知（下一次 reload 多重启一次），属于连接生命周期改动，单独做 |

依据：`apps/macos/Tono/Services/AppState+Proxy.swift` 的 reload 只在 `/core/sync` 返回之后才更新 `loadedRuntimeConfigDigest`，pins 刷新失败的分支保留会话和旧摘要；helper 在发送应答之前就已经换了进程（`tooling/scripts/core-helper/CoreManager.swift`、`SocketServer.swift`）。之后的完整 reload 用旧摘要比较，相等就记 `core_config_reload_skipped_unchanged` 并返回。后果是策略没有按 App 以为的那份生效（例如 pins 已是新的一份而 App 认为是旧的），下一次不相等的 reload 或重新连接会纠正。没有实机复现。Codex 第二轮评审（#1334）指出。
