| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-SYNC-REPLY-LOST-DIGEST | macOS helper 已经按 `/core/sync` 换了 Core 进程但应答丢失时，App 记的「已安装文档摘要」还是上一份；之后相同配置的完整 reload 判定「没有变化」跳过 sync，实际运行的是另一份文档 | in-PR | [#1334](https://github.com/raydocs/tono/pull/1334) 评审发现 / [#1342](https://github.com/raydocs/tono/pull/1342) | 中·推导 | 只改 `reloadCoreConfig` 的保留会话路径：应答丢失（空应答、无效应答、未知错误）时摘要记为未知，下一次完整 reload 多重启一次 Core；helper 明确拒绝或请求没送到时摘要不变。摘要未知期间连续多次被拒绝后槽位可能绕回、`ok:false` 也可能是旧进程已停，见下文。节点切换和可选策略替换失败本来就走断开，断开会清摘要，未改。未实机 |

依据：`apps/macos/Tono/Services/AppState+Proxy.swift` 的 reload 只在 `/core/sync` 返回之后才更新 `loadedRuntimeConfigDigest`，pins 刷新失败的分支保留会话和旧摘要；helper 在发送应答之前就已经换了进程（`tooling/scripts/core-helper/CoreManager.swift`、`SocketServer.swift`）。之后的完整 reload 用旧摘要比较，相等就记 `core_config_reload_skipped_unchanged` 并返回。后果是策略没有按 App 以为的那份生效（例如 pins 已是新的一份而 App 认为是旧的），下一次不相等的 reload 或重新连接会纠正。没有实机复现。Codex 第二轮评审（#1334）指出。

2026-10-02 续记（[#1342](https://github.com/raydocs/tono/pull/1342)）：`reloadCoreConfig` 在 `/core/sync` 抛错且应答丢失时把 `loadedRuntimeConfigDigest` 置空。helper 的 sync 在应答之前先停旧进程再起新进程（`CoreManager.sync`），App 侧 20 秒收不到应答读成 `emptyResponse`。摘要为空时紧接着的下一份文档按新槽位渲染，不会与正在运行的任一份 fake-IP 槽位相同（计数在每次渲染后已经前移）。

仍开着的两点（Codex 评审 #1342，均为 minor）：

- 摘要未知期间渲染不再避让任何槽位。应答丢失之后如果连续六份文档都在停旧进程之前被 helper 拒绝，第七份会绕回旧进程的槽位（共八个槽位），那一次替换后应用缓存的 fake-IP 可能在 30 秒 TTL 内对到别的域名。要补上需要把「摘要未知」和「仍须避让的槽位」分开保存。
- helper 回答 `ok:false` 不等于旧进程还在：停掉旧进程之后新进程起不来也是这个应答，此时摘要保留旧值而没有 Core 在运行。Core 监视在两个周期内（约 10–15 秒）发现隧道消失并走断开，断开会清摘要；这段时间内一次相同配置的完整 reload 会被跳过。本 PR 之前就是这样，未改。
