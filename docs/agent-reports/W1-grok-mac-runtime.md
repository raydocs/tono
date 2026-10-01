# W1-grok-mac-runtime

Hunter: Grok 4.7。席位：macOS 运行时 M5–M8（第二个强模型，在 Sol/GLM 之后）。产品身份是 Tono。基线从 `origin/main` `ff81118a`（#756 已合）开始，报告分支从 `origin/main` `5ba113d2` 拉出。

范围：

- M5 `HelperManager`、`HelperProtocolVersion`、`PrivilegedRuntimeCoordinator`、`RuntimeCleanup`、`NetworkProtectionOperations`、`CoreRuntimeManager`
- M6 `AppState+Connect`
- M7 `AppState`、`ExitHeal`、`AppState+LaunchProtection`、`AppState+Persistence`、`Services/Persistence/*`
- M8 `AppDelegate`、`PhysicalNetworkReachability`、`NetworkUplinkSnapshot`、`KillSwitchService`、`ConnectionCoordinator`、`ProtectedReconnectSchedule`

本机没有 Xcode。下面每个修复的 XCTest 都交给 hosted macOS CI。没有改 helper 契约，没有改 `HelperProtocolVersion`，没有改 `docs/DECISIONS.md`。

## 核实表

| ID | 区域 | 等级 | file:line | 一句话 | 结论 |
|---|---|---|---|---|---|
| MAC-APIPA-GATEWAY-ROAM | M8 上行 | 中·推导 | `NetworkUplinkSnapshot.swift:178` | DHCP 续租时网关变成 169.254/16，仍被当成新网络，隧道被拆、PF 保持武装 | 已修，[#835](https://github.com/raydocs/tono/pull/835) |
| MAC-RESOLVER-DIR-HIDES-SPLIT-DNS | M5/M8 DNS | 中·推导 | `SystemProxy.swift:553` | `/etc/resolver` 有一个文件读不了时，动态存储里已知的分流 DNS 被整表丢掉，审计停在 unverifiable，会话继续 | 已修，[#836](https://github.com/raydocs/tono/pull/836) |
| MAC-LAUNCH-STATUS-TIMEOUT | M5 启动 | 中·推导 | `RuntimeCleanup.swift:248` | `/update/status` 读超时是 `emptyResponse`，原先只把 `connectFailed` 当 helper 没应答，启动修复和「当前未受保护」提示都不走 | 已修，[#840](https://github.com/raydocs/tono/pull/840) |
| MAC-INITIAL-DATA-DOUBLE-APPLY | M7 启动 | 低·推导 | `AppState+Persistence.swift:12` | 第二个主窗口的 scene task 在第一次应用挂起后再装一遍缓存目录；失败分支会清掉非 custom 节点。`allowRuntimeTransition` 为 false，这条路径不武装 PF | 已修，[#854](https://github.com/raydocs/tono/pull/854) |
| MAC-RECONCILE-DNS-COPY | M7 文案 | 低·推导 | `AppState.swift:560` | DNS 已坏且上行没有 `.moved` 时，仍显示「当前网络变了」 | 真实未修。[#861](https://github.com/raydocs/tono/issues/861)。改文案会变成 ui-review，不能自动合并 |
| MAC-HEALTH-CLEARS-ERROR | M6 健康检查 | 低·推导 | `AppState+Connect.swift:1777` | 健康成功且没有 advisory 时把任意 `errorMessage` 清掉，目录被拒的提示大约 10 秒后消失 | 真实未修。[#863](https://github.com/raydocs/tono/issues/863)。这一拍的探针不是测试缝，本环境写不出稳定失败测试 |
| MAC-TUN-WAIT-CANCEL | M6/M7 连接 | 低·推导 | `AppState.swift:2162` | 最后一次 `try?` sleep 吞掉取消，函数按接口是否存在返回。连接路径会先 `armKillSwitch` 再 `checkCancellation`。按席位标尺是 P2（最后 100ms，不是单点断网） | 真实未修。[#864](https://github.com/raydocs/tono/issues/864)。调用的是 `KillSwitchService.interfaceExists` 而不是 `tunInterfaceExists` 缝。取消之后的断开仍会放开 |

## 有意设计，不当缺陷修

| 主题 | 位置 | 原因 |
|---|---|---|
| 退出清理 20 秒到点不紧急解除 PF | `AppDelegate` 的终止截止 | fail-closed。严格模式才允许断掉一切；到点拆 PF 会在更新或 helper 无应答时把网络放开。不修 |
| `pendingNativeUpdate()` 任意抛错都中止退出时的 release | `AppDelegate.finishTerminationCleanup` | 读不到更新所有权时，不能把「helper 不可达或正文损坏」当成「没有更新持有保护」。#840 没有改这条 |

## 拉取请求

自动合并用 merge commit（`gh pr merge --auto --merge`）。本席对下面四个 head 启用过，GitHub 当时记下 method MERGE。`raydocs` 用户随后关闭（最近一次 2026-10-01T00:27:22Z 至 00:27:27Z，`performed_via_github_app` 为空）。这不是推送 token 失败。标签接口对本集成返回 HTTP 403（`Resource not accessible by integration`），本席加不上标签。

| PR | 分支 | head | 自动合并 | 标签 |
|---|---|---|---|---|
| [#835](https://github.com/raydocs/tono/pull/835) | `hunt/grok-macrt-apipa-gateway` | `2dcc2471be50132b19bf5d5f8f488a62dc4dce6c` | MERGE | `needs-hardware` 已在 PR 上（不是本 token 加上的） |
| [#836](https://github.com/raydocs/tono/pull/836) | `hunt/grok-macrt-split-dns-files` | `54d94095f1553d7549c3ccfa650390be7e750d94` | MERGE | `needs-hardware` 已在 PR 上（不是本 token 加上的） |
| [#840](https://github.com/raydocs/tono/pull/840) | `hunt/grok-macrt-launch-status-timeout` | `c14512a713c57196d443f75d39bee928e8061110` | MERGE | 应有 `needs-hardware`。POST labels 403，目前无标签 |
| [#854](https://github.com/raydocs/tono/pull/854) | `hunt/grok-macrt-initial-data-once` | `25a111c715e8de9b8687824faccadf767f2d8620` | MERGE | 不需要。只改启动时的内存应用，不改路由、TUN、PF、DNS、防火墙 |

四个 head 都已合入当时的 `origin/main`（报告时 `5ba113d2`），避免 BEHIND 卡住合并队列。

## 已开问题

- [#861](https://github.com/raydocs/tono/issues/861) MAC-RECONCILE-DNS-COPY
- [#863](https://github.com/raydocs/tono/issues/863) MAC-HEALTH-CLEARS-ERROR
- [#864](https://github.com/raydocs/tono/issues/864) MAC-TUN-WAIT-CANCEL

## 不重复上报

对照已开或已合 PR、以及已知总账后放下，没有新开条目：#720 武装失败后的放开、#756 启动 DNS 清扫（已合）、#759 升级轮询卡住、#760 健康检查（DoH 保留、`wanted == false`）、#761 PF 占位写入、#762 日志流重启路由、#763 helper 恢复（`repairedSinceArm`、紧急解除、启动 DNS、FIFO）、#765 受保护 DNS 超过 8 个、#773 连接中崩溃后的 helper 孤儿、#774 系统代理管理员提示、#778 可选 DIRECT 策略失败拆除、#782 在 utun 之前武装 PF、#785 更新退役状态、#794 旧 helper 升级取消仍留着 PF、#795 `protectedOffline` 更新提交、`HelperManager.writeAll` 的 SIGPIPE、#710 helper 卡在 D 状态时没有外部看门狗。目录更新与节点切换、账号 token/401、钥匙串重试、websocket 停住、AI 直连后缀在另一席进行，不在本席文件表里。

## 假阳性

下面 26 条读过调用链之后否定，不单开 issue。

| # | 假设 | 否定理由 |
|---|---|---|
| 1 | 看门狗 `if a, b, c == .x \|\| c == .y` 的优先级写错 | Swift 条件列表的逗号把第三项收成一个表达式，实际是 `a && b && (c == .x \|\| c == .y)`。睡醒后的代际检查不会拆掉更新的一次连接 |
| 2 | 唤醒暂停条件会把正在进行的显式放开改写成唤醒重连 | 条件是 `(paused && !lifts) \|\| heldAfterRestart`，与 H18-G-F1、R1-F2 一致 |
| 3 | PF 健康条件 `wanted && (repaired \|\| !live)` 写反 | 这是有意的健康谓词。`wanted == false && live == false` 已在 #760 |
| 4 | DNS 损坏或补充解析器冲突时保留会话是泄漏 | 有意扣住。PF 的 LAN DNS 拦截盖不住另一条 VPN utun，所以审计选择留下而不是拆掉 |
| 5 | `ExitHeal` 没人调用就是故障 | 按设计不接线，不是当前路径上的缺陷 |
| 6 | `daemonKeepsRestarting` 的 25 秒会挂死机器 | 有界的崩溃循环检测（TM-claude-2） |
| 7 | 两次不可达探测后 `explicitReleaseRequiresRepair` 为真会在断开时修一个还在武装的 helper | 「恢复互联网」需要能修一个已经死掉的 helper。断开会先等连接任务结束 |
| 8 | `arm()` 全假回复把 `isArmed` 留成 true，随后保留路径又武装 | 与 #760 相邻。本席不另开一条去对着干 |
| 9 | 核心监控代际检查漏了 | 读过的代际比较在拆掉会话前会再看一代。断开会取消 `networkEnvironmentTask` |
| 10 | `onCoreStarted` 返回 false 时 `isConnected` 仍为 true | 顶起代际的那次断开会清掉。唤醒若先顶代际、恢复任务还没断开，只是一小段闪烁，够不上单点断网 |
| 11 | TUN 丢失 fail-open 之后 `scheduleProtectedReconnect` 把刚放开的网络又武装上 | 自己的成功 release 会把 `isProtectionBlocked` 清掉，reconcile 返回 false，随后的 `connect()` 是预定的恢复，不是把 fail-open 偷偷取消 |
| 12 | `getifaddrs` 第一个地址的顺序变化会显示成换了网 | 触发不稳定，没有可重复的用户路径 |
| 13 | `isProtectionUnconfirmed` 时 Retry 按钮把用户困住 | 界面走 Connect，`connect()` 能跑 |
| 14 | 连接失败路径上的 `MainActor.run` 会把自己死锁 | 若成立，每一次失败连接都会冻住界面。生产没有这条症状，不追 |
| 15 | 崩溃发生在删掉 boot-session 标记之前，下次启动被永久按住 | 同一次启动里按住自动恢复是写明的保守行为 |
| 16 | `lstat` 之后的 errno 判断短路写错 | 短路顺序与注释一致 |
| 17 | actor 里的 `usleep` 会挂起整台机器 | 挡住的是协作线程。界面在主 actor 上 |
| 18 | `applySettingChange` 能和断开赛跑，把系统代理重新打开 | 没有调用方 |
| 19 | `curlHTTPS` / `CancellableProcessBox` 会把 continuation resume 两次 | 取消会终止进程；continuation 由工作线程 resume 一次 |
| 20 | 当前 boot session 读不出来时仍自动恢复 | 读不出来就按住，是写明的保守行为 |
| 21 | `!isArmed` 且 helper 不可达时 `disarm()` 不探测 PF 就返回成功 | helper 提交 PF 和 UserDefaults `isArmed = true` 之间是毫秒窗口。启动时 helper 能应答的话，`adoptLaunchObservation` 会再读一次 |
| 22 | `/update/status` 的每一种错误都应走「没应答」 | `forbidden` 和坏正文是应答。#840 只纳入 `connectFailed`、`emptyResponse`、`socketFailed` |
| 23 | `protectedDNSService == nil` 且已连接时，调和把 DNS 判成 `.broken` 并拆会话 | 生产在 `isConnected` 之前装上该服务，只在成功 release 或外部 release 时清掉 |
| 24 | launchd 运行次数前缀 `\truns = ` 对不上 `launchctl print` | 现有测试与 `launchctl print` 的格式一致 |
| 25 | IPv4 取第一个可用地址会把链路本地当成全局地址 | `usableIPv4` 会去掉 169.254。网关侧的缺口是另一条，已在 #835 修 |
| 26 | 条件列表把看门狗的睡醒检查和「更新的一次尝试」绑错 | 与第 1 条同一处代码再对过调用方：睡醒后的代际不等就直接返回，不拆新会话 |

第 26 条是第 1 条的调用方复核，仍算一次独立假设（看的是睡醒后的返回，不是运算符本身）。

## 计数

- 假设共 53：已修 4，真实未修 3，有意设计 2，已有条目不重复 18，假阳性 26。
- 假阳性 26。
- 本机未跑 `xcodebuild`。

## 没有读完的部分

- `HelperProtocolVersion` 只对照了重叠 PR。当前是 4.52.7，本席没有加版本。
- `AppState+Persistence` 里除 `loadInitialData` 以外的写入路径没有逐行收尾。
- `AppState+Connect` 大约 2450 行之后的备份通道只读了一部分。
- `AppState+Proxy` 的节点切换不在本席文件表里，`finishNodeSwitch` 读过的部分站得住，没有整文件收尾。
- 在线会话里的目录安装拆除没有做一遍完整追踪。
- 没有把每一份 macOS `docs/findings.d` 分片再对一遍当前源码。
