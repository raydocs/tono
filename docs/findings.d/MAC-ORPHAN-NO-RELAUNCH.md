| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-ORPHAN-NO-RELAUNCH | App 在保护未解除时崩溃或被强退后，没有东西把它拉回来：菜单栏图标消失、没人重连；出口正常时隧道一直跑但用户看不到状态，出口坏了要等约 70 秒放开（决策 049），之后用户仍要手动重开 Tono | fixed(854e91cc) | [#1269](https://github.com/raydocs/tono/issues/1269) 的后续；[#1362](https://github.com/raydocs/tono/pull/1362) | 中·推导 | 所有者 2026-10-03 决定拉起（[决策 052](../decisions/052-2026-10-03-macos-helper-relaunches-dead-owner.md)）。没有实机验证。只拉起 `/Applications/Tono.app` 的 Developer ID 签名包，开发构建不触发。打开请求不等待返回（Codex 评审 major 已修）；评审留下两条 minor：签名校验与 `open` 之间存在用户替换 bundle 的窗口（以用户身份运行，非提权，和原生升级拉起路径相同）；`isAwake()` 判断之后、`open` 发出之前进入睡眠的窄竞态只会多发一次无害的打开请求 |

依据（`main` `eb363310`）：`SocketServer.observeCoreForWatchdog` 的两条孤儿路径（`observeOrphanedBootstrap`、`observeOrphanedTunnel`）只会放开保护，没有任何路径重新启动 App；App 侧 `acceptCloudOnlyTransport(resumeProtection:)` 在启动时见 PF 已武装会自动重连，但前提是 App 被启动。原生升级路径 `UpdateExecutor.launchSuccessor` 已经用 `launchctl asuser <uid> sudo -u #<uid> open /Applications/Tono.app` 从 root 拉起 App，有实机先例。

修复（本 PR）：`observeOrphanedOwner` 在每次空闲检查开头运行：记录的属主已退出、PF 状态文件存在、机器醒着、没有待执行的原生升级时，校验已安装包的签名后用同一条路径打开它；同一属主最多两次，间隔 `orphanedOwnerRelaunchSpacing`（3 次检查，约 30 秒）；新的 arm/start 记录新属主时计数清零。决策函数 `orphanedOwnerRelaunchDue` 有自测。helper 协议 `4.52.40`。

未关的限制：
- 没有 Mac 实机验证：`sudo -n -u` 在 launchd 守护进程上下文里能否无密码执行，依赖原生升级路径的既有证据。`open` 不被等待，返回非零只写 stderr。
- Codex 评审（gpt-6.1-sol high）留下的 minor，记录为开放：(1) `verifyCode` 通过后、`open` 启动前，拥有该 bundle 的用户可以替换内容——以该用户身份运行，不是 root 提权，和 `UpdateExecutor.launchSuccessor` 相同；(2) `isAwake()` 返回 true 后到发出 `open` 之间若恰好进入睡眠，仍会发一次打开请求，arm/start 的睡眠门不变，PF 不变。
- 上限按属主计：新 App 成功 arm/start 后再崩溃，额度重算；一条连续崩溃链不是全局两次。
- 用户强退 Tono 而保护仍在（PF 状态文件存在）时，App 会被拉回来。正常退出先解除保护、清掉属主，不触发；退出清理超时、PF 刻意保持 fail-closed的那种情况会触发。
- App 拉起后是否重连取决于它自己的条件（已登录、目录可用、没有待选择项）；不满足时它只显示状态，决策 049 的放开照常。
- 开发构建或不在 `/Applications` 的安装不触发（签名校验失败，写 stderr）。
