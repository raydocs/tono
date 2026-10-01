# W2 Grok helper hunt（2026-09-30）

Hunter: Grok 4.7。槽位 W2-grok-helper。开始时基线 `origin/main` `ff81118a`；报告正文对着 `36844a4a`。文档 PR 基于 `71bd69d8`，`36844a4a..71bd69d8` 没有改 helper 源码。范围只限 root helper：M1 `main` / `SocketServer` / `HelperPower` / `HelperHTTP` / `PeerAuthorization`，M2 `KillSwitchPF` / `KillSwitchManager`，M3 `ProtectedDNSManager` / `CoreManager`，M4 `Update{Transaction,Storage,Runtime,Package,Executor}`。

没有部署、没有发布、没有跑 jev-route。本机没有 Swift 工具链，helper `--self-test` 未在本地执行。

## 结论表

| ID | 区域 | 严重度 | 文件:行 | 一句话 | 结论 |
|---|---|---|---|---|---|
| MAC-ARM-PRELOAD-RELEASE | M2 | P1（高·推导） | `KillSwitchManager.swift` arm / `secureForPowerTransition` 的失败 catch | 再次 arm 或睡眠屏障在 `pfctl -f` 接受新规则之前失败，仍 flush 内核里上一份 `tono.killswitch`，Core 还在跑 | 已修 [#889](https://github.com/raydocs/tono/pull/889) |
| MAC-HEALTH-UNPROVEN-DOWN | M2 | P1（中·推导） | `KillSwitchManager.health` | 一次 pfctl 超时或单次「未过滤」被报成 `live: false`，App 断开且不释放，PF 仍武装 | 已修 [#889](https://github.com/raydocs/tono/pull/889) |
| MAC-DNS-STATUS-BY-NAME | M3 | P2（中·推导） | `ProtectedDNSManager.statusResponse` 按显示名读 | 服务改名后 status 说未配置，App 当 DNS 坏了断开，PF 仍武装；restore 已经按 `serviceID` | 未修，[#893](https://github.com/raydocs/tono/issues/893)。等 #889 的协议号落地再改 helper |
| MAC-LAN-DNS-STALE-NIC | M2 | P2（中·推导） | `KillSwitchPF.renderRules` 的 `en*` 范围 | arm 之后新出现的网卡上，LAN DNS/DoT 避开按接口的阻断、命中不限接口的 `tono-lan`；公网仍被 `block drop` | 未修，[#894](https://github.com/raydocs/tono/issues/894)。不是完整 AI 旁路；放宽成全局阻断会误伤公司 VPN |
| MAC-PF-X-FORGET | M2 | P3（低·推导） | `KillSwitchPF.releasePFEnableReference` | `pfctl -X` 非 0 仍删掉 token 记录；锚点已经空，不留下阻断 | 未修，[#895](https://github.com/raydocs/tono/issues/895) |
| MAC-UPDATE-FLOOR-REREAD | M4 | P2（低·推导） | `UpdateTransaction.live` `installedFloor` → `UpdatePackage.buildSource` | 签名校验之后再按路径读 `tono-build-source.json`，用户仍拥有 App 包时可以在窗口里把下限换成更旧的已签名版本 | 未修，[#896](https://github.com/raydocs/tono/issues/896)。毫秒级；原生更新把包收成 root 之后窗口关闭 |
| MAC-STALE-CORE-PID-REUSE | M3 | P2（低·推导） | `CoreManager.terminateOwnedCore` | 等待期间 pid 被复用后，SIGKILL 不再核对路径和 uid | 未修，[#897](https://github.com/raydocs/tono/issues/897) |
| #765 DNS 超过 8 台 | M3 | — | `ProtectedDNSManager` 快照 `count > 8` | 保存时不封顶，读回拒绝，恢复改走无快照清扫 | 重复。在飞 PR，不另开 |
| #761 占位文件先于 flush | M2 | — | `releaseSequence` | 占位写入失败就到不了 flush | 重复。在飞 PR |
| #763 启动失败 DNS / FIFO / 僵尸 core | M1 | — | `main.swift` 启动失败路径 | 启动失败只拆 PF、不恢复 DNS | 重复。在飞 PR |
| #773 连接中途 App 崩溃留下 PF | M1 | — | `SocketServer` | 已有在飞修复 | 重复，未再证伪 |
| #795 Protected Offline 不能 commit | M4 | — | 更新义务相等 | 本树在开题时仍无 `recoverySatisfies` | 重复。在飞 PR |
| #691 紧急解除与坏账本 | M1 | — | `main.swift` | 明确不碰 | 重复 |
| BRICK-M8 回滚失败 | M4 | — | `UpdateExecutor` | 失败先释放 PF，不把回滚记成成功 | 重复 |
| SFO-1 没有 AI 第二层 | M2 | — | — | 开题时 #738 未合；报告时 #738 已在 main（4.52.8） | 不另报 |

## PR

| PR | 分支 | 头 | auto-merge | 标签 |
|---|---|---|---|---|
| [#889](https://github.com/raydocs/tono/pull/889) | `hunt/grok-helper-arm-release-6122` | `87181a2d` | 已开，merge commit。写本报告时仍开着，没有被关掉，所以没有再开一次 | `needs-hardware` 没有打上：`POST /issues/889/labels` 返回 `403 Resource not accessible by integration`。这是实机网络行为（何时 flush 活的 PF 锚点、health 如何报 live） |
| [#920](https://github.com/raydocs/tono/pull/920) | `hunt/grok-helper-report-6122` | 本 PR | 不开。留给合并队列成批处理 | 无 |

## 假阳性（21）

考察 36 条假设。2 条已修，5 条证实后只开 issue，8 条是上表里的重复项，21 条否掉。

| 假设 | 为何否掉 |
|---|---|
| 配置目录穿越或把 `config.json` 换成符号链接，root 去读任意文件 | `validateConfigDirectory` 加 `O_NOFOLLOW`，摘要对上 App 写出的字节 |
| 摘要可被绕过 | 长度和大小写都拒；允许表和 `sing-box check` 跑在 root 副本上 |
| `ech.config_path` 是 helper 套接字提权 | 只有签过名的 Tono 能 `start`；摘要绑的是 App 写出的字节，不是套接字身份被绕过 |
| 更新 zip 路径穿越 | 名字必须留在 `Tono.app/` 下，拒绝 `..` 和符号链接模式；`ditto` 只跑在对上签名摘要的私有副本之后 |
| 用符号链接换掉 root 二进制 | 复制进 root `0700` 目录再 `rename`；`/Library/PrivilegedHelperTools` 用户不可写 |
| 回滚删掉唯一一份好二进制 | 恢复前重哈希 backup，并再查 Developer ID |
| disarm 和 status 互相重装 | `status()` 不装规则；#710 仍成立 |
| Core 短暂停时 watchdog 重装全阻断 | Core 不在时走 withhold，到阈值才 disarm，不调用 `superviseProtection` |
| 死掉的 Core 永不释放 | 退出大约 30 秒后释放；启动时 Core 不在也会释放 |
| `pfctl -a tono.killswitch -F all` 清掉 Apple 锚点或全机状态 | 带锚点的 `-F all` 只清该锚点；全机 `-F states` 只在显式 `.full` |
| 普通 arm 重载主规则集 | 钩子没变、锚点还在时只 `-a tono.killswitch -f` |
| 规则文本被请求字符串注入 | 隧道名、地址、端口在渲染前校验；接口名是 `en` 加数字 |
| 严格杀开关被误释放 | macOS 没有这个开关；失败路径传入的是 `false` |
| 部分 DNS 恢复失败仍删快照 | 读/写/读回失败在 `removeSnapshot` 之前抛出 |
| 禁用的网络服务被跳过 | `allServices()` 使用 `includingDisabled: true` |
| 启动成功路径先拆 PF 再恢复 DNS 是新洞 | 与 #763 的恢复顺序相同；恢复失败仍放行。偏好锁卡住是第二次失败 |
| 套接字只认 UID | 要求标识符、团队 OU，以及 `get-task-allow` absent |
| `peerIdentity` 失败时 GET 仍可用，等于提权 | 变更仍要求 peer bundle；GET 只读状态 |
| 静默升级在校验和 `install` 之间被换源 | 根目录副本在 `rename` 之前再次 `verifyCode` |
| 更新签名没有绑到包字节 | stage 和执行器都会再哈希 `package.zip` |
| 已消费的更新失败会让 KeepAlive 空转着装屏障 | `armEmergencyBlock` 现在是 `releaseInstalledBlock` |
| 活着但卡住的 sing-box 应该被 watchdog 拆掉全阻断 | 拆掉就是把网络全开。#738 的窄层只挂在 Core 已退出的崩溃/启动释放上。要改这条得另做产品决定 |
| 负载已被接受之后的失败释放没有装上 #738 窄层 | #738 把窄层放在 `releasePersistedBlock`（崩溃/启动），不放在 `releaseInstalledBlock`。本 PR 不扩大这个分界 |

## 没做完的

- 没有在本机跑 `swiftc` 或 `--self-test`。#889 的自测交给托管 macOS CI。
- 按「一次只开一个 helper PR」，DNS 状态、LAN DNS 范围、`-X`、更新下限、pid 复用都只开了 issue，没有第二份协议号改动。
- 没有实机 pfctl。`pfctl -f` 非 0 是否从不改内核，没有在 Mac 上核对。
- M4 的包校验和状态机按调用链核对过决定性函数；没有把 `UpdateExecutor` 的每一行都当成新的失败注入再跑一遍。
