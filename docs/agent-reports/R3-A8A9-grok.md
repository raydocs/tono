# R3-A8A9-grok（2026-10-01）

Hunter: Grok 4.7。基线 `origin/main` `a864a9ca`（阅读时的代码与 `ed9940cd` 上这几份文件相同，该区间没有改 Catalog、Proxy 或 A8/A9）。不部署、不跑 jev-route。Swift XCTest 与 Windows 原生测试未在这台 Linux 上跑。

范围：

- 补完 macOS `AppState+Catalog.swift`、`AppState+Proxy.swift` 的逐行阅读。
- Windows A8：`windows_dns.rs`、`encrypted_dns.rs`、`browser_dns.rs`、`signed_apps.rs`、`audit.rs`、`local_evidence.rs`。
- Windows A9：`commands/{restore,terminal,diagnostics,support,catalog,connection_cmd,mod}.rs`，`telemetry.rs`，`diagnostics.rs`，`log_upload.rs`，`support_reports.rs`，`utils/{schtasks,server,init,dirs,network,singleton}.rs`。

Sol 的 `W1-sol-win-app` 报告在 `main` 和当时打开的 PR 标题里都没有。对照的是已打开或已合并的同区 PR，而不是那份尚未入库的报告。

## 结论表

| ID | 区域 | 严重级别 | 文件:行 | 一句话 | 结论 |
|---|---|---|---|---|---|
| MAC-CATALOG-NODE-REMOVED-BLOCK | M10 目录 | 决定项 | `AppState+Catalog.swift:148` | 选中的云出口被目录删掉后 `disconnect(releaseKillSwitch: false)`，没有默认出口时整机继续被 PF 挡住 | 接受注释里的失败关闭。选择性只拦助手的钩子仍未接上，放开则会让助手直连。不改代码，不改 `docs/DECISIONS.md`，不另开 issue |
| MAC-POLICY-RELOAD-BLOCK | M10 策略 | 决定项 | `AppState+Catalog.swift:606` | 已连接时流量策略变了，会拆掉会话并保持 PF，再安排保护重连，文案写明不打开直连互联网 | 同上，书面失败关闭。不修 |

没有新的已核实缺陷，因此没有修复 PR，也没有新 issue。#901（登录钥匙串）按要求不修。

## 网络影响

本 PR 只加报告，不改路由、DNS、PF、WFP 或代理。上面两条决定项维持现状：目录删掉当前出口，或已连接时策略更新，都会保持整机阻断，直到重连成功或用户点 Restore internet。

## 假阳性（38）

Catalog / Proxy（17），本回合逐段读过安装、策略、钉选刷新、切换和重载：

1. 更旧的目录修订覆盖已安装目录。修订更小直接返回。
2. 同修订不同摘要被当成已安装。还要比摘要和路由令牌。
3. 住宅 SOCKS 校验失败仍写入缓存。`validatedCatalogRouting` 在 `persistIfNewest` 之前抛出。
4. 账号切换后仍拨上一个账号的出口。`purge` / `adopt` 丢掉已安装目录并删运行时配置；权利封锁的注释写明停掉正在跑的核心且 PF 保持。
5. 有长连接时目录永远不应用。延后有上限，然后强制 `reloadCoreConfig`。
6. 钉选合并把还能解析到的地址换成新切片，导致反复重载。重叠非空就保留旧钉；这是写明的防抖。
7. 解析把受保护地址收成 DIRECT 钉。公网 IPv4 校验之后还排除受保护地址。
8. 钉选超出会话端点上限就丢掉全部网页钉。先按预算裁剪再校验。
9. `reloadCoreConfig` 在 `coreController == nil` 时已经武装 PF 然后返回。控制器在调用当时捕获；产品调用方是已连接的目录或钉选路径。
10. 节点切换失败后宣称已连上新出口。`recoverFailedNodeSwitch` 先记下目标，再 `disconnect(releaseKillSwitch: false)` 并重连，不把过渡当成成功。
11. 切换只武装新出口，旧出口被自己的 PF 挡住。先武装旧出口并上新出口。
12. 产品模式能切到全局或直连。`setProxyMode` 在自有模式下拒绝非 Rule。
13. 自定义节点增删改会在产品连接上重写核心。失败走同一条失败关闭重连；托管目录不走这些入口。
14. 同名重选会重载核心。已连接且目标相同只持久化选择。
15. 钉选刷新在空闲或流未结束时丢掉新地址。空闲跳过、流延后，都有审计。
16. 策略热更新把助手域名收成网页后缀。后缀校验仍走 `validatedManagedDirectSuffix`；路由顺序是 #867，不在这两份文件里重做。
17. 无签名策略替换已签名修订。`revisionOrder` 仍让已认证修订压过未认证。

A8（5），与 [Hunt Windows A8 DNS](bc-0e731359-b39c-5421-93e0-f6e90be0867c) 一致：

18. `windows_dns.rs` 查询超时把连接事务挂死。调用方在预算加 2 秒后不再等回调；查询失败走既有失败表，未验证的连接会放开，除非已经验证过且用户打开了严格阻断。
19. DoH 探测只看 32 块网卡，漏掉的那块会留下加密 DNS。探测只是横幅；服务会关 `EnableAutoDoh` 并装 NRPT。SOL2 对 `encrypted_dns` 的结论没有被推翻。
20. 浏览器配置扫描漏掉配置文件里的 Secure DNS，Chrome 因此绕过。`dns_over_https` 在浏览器级 Local State；不完整扫描在武装之前失败关闭。
21. 签名目录前缀让助手进程 DIRECT。前缀锚在已验证目录上，目录或祖先可被普通用户写时只给精确文件；助手规则在这些规则之前。过期路径是 #900，助手主机钉住是 #871。
22. 审计通道满了会改 WFP 或把令牌写进日志。满通道只丢行；`log` 不武装也不放开。

A9（16），与 [Hunt Windows A9 commands](bc-7a8634bd-488b-533e-b90e-5589fb2a99d9) 一致：

23. 启动时把 `wanted: false` 当成过滤已经不在。服务自己会重试那次放开。
24. 保护探测之前的状态显示已登出。与 #784 同一窗口。
25. `ProtectedOffline` / `Unknown` 跳过启动恢复。`adopt` 故意不把非 Connected 收成已连接；探测把 FSM 标成武装后，Disconnect 仍在。
26. Restore internet 之后更新恢复仍去 Connect。`update_recovery_connect_allowed` 看代数；卡住的 DIRECT 重载是 #898。
27. 选服务器先公布名字，工人失败后 WFP 不回滚。回滚在 `switch.rs`；出口消失是 #791；选择竞态是 #798。
28. `tono_close_*` 拆掉隧道。只把请求交给当前这一代控制器。
29. 计划任务按 CSV 删掉别的用户的登录任务，或把禁用任务报成启用。路径要精确匹配，主体对不上就拒绝。
30. 清掉注册表代理后，仍在跑的 Claude 被报成就绪。只有 Tono 自己没继承该变量时才会这样；再加上进程还活着，是两个条件。
31. 诊断上传带出节点 IP 或令牌。白名单加上 `known_secrets`，再去掉 UUID、IPv4 和不透明串。
32. 控制器令牌发到被复用的 `127.0.0.1` 端口。绑定竞态，最多 P2。
33. 遥测只做 `redact()`。#724；没有一条已核实的路径把活令牌放进会上报的字段。
34. 日志上传带上一个账号的审计行。`_uploadScope` 必须一致，范围一变游标就重置。
35. `server.rs` 的 `/commands/pac` 没有实例令牌。浏览器发不出这条；可见路由要令牌；`clash://` 接收入口是空操作。
36. `init_scheme` 注册了 `clash://`。这个函数没有被调用。
37. `network.rs` 可以关掉证书校验。`accept_invalid_certs` 直接失败，没有调用方把它打开。
38. 单实例锁让第二个进程无法放开 WFP。恢复实例不是放开路径；放开在主实例的 Disconnect。

## 计数

假设 40。修复 0。决定项 2。假阳性 38。没有重复开 PR。

## 没做完的部分

- Sol 的 `W1-sol-win-app` 报告正文没有入库，不能逐条对照它写过的句子，只能对照上面的 PR。
- `signed_apps.rs` 的 Authenticode 调用和 `audit.rs` 的轮转写入没有在 Windows 上跑。
- `account.rs`、`quit.rs`、`update.rs` 不在本槽，只在 A9 调用它们的地方看过。
- A1（`connection.rs`）和 C8（迁移）不在本槽。

Hunter: Grok 4.7
