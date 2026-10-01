# W1-grok-mac-config（2026-09-30，续记 2026-10-01）

Hunter: Grok 4.7。范围：macOS M9 配置与策略签名、M10 代理/更新/订阅/线路、M11 账号与钥匙串、M12 连通性/sidecar/WebSocket。首轮基线 `origin/main` `50bbbbf0`；10-01 续记对照 `17580a26`。不部署、不跑 jev-route。Swift XCTest 在这台 Linux 云代理上不能跑（没有 `xcodebuild` / Swift），未安装工具链。

## 结论表

| ID | 区域 | 严重级别 | 文件:行 | 一句话 | 结论 |
|---|---|---|---|---|---|
| MAC-ASSISTANT-DIRECT-GAP | M9 路由 | P1（中·推导） | `ConfigPipeline+SingBoxProduct.swift:157`、`ConfigPipeline+Runtime.swift:691`（基线 `50bbbbf0`） | 没有住宅跳时不发出助手域名/`160.79.104.0/21` 规则，已审核应用的进程直连先匹配，TCP 直出物理网卡；有住宅跳时这些规则只覆盖 TCP，同一进程的 UDP 仍直连 | 已在 [#867](https://github.com/raydocs/tono/pull/867) 修复。2026-10-01 00:33 UTC 起 auto-merge 为 MERGE（启用者 raydocs）。本回合没有切换它。`needs-hardware` 仍未打上（先前两次 `POST` 403） |
| AI-DIRECT-SUFFIX | M9 策略 | 不新开等级 | `ConfigPipeline+Direct.swift` `directSuffixOverlapsProtected` | 受保护后缀列表没有 OpenAI 等助手域，签名策略仍可能写入这些后缀 | 重复已合并的 #797（`c6cae3b9`）。本槽不改该校验。#867 让路由规则先于后缀直连 |
| MAC-DNS-CACHE-BATCH | M12 DNS | P1（中·推导） | `ProtectedSystemResolver.swift:170`（基线 `17580a26`） | `MoreComing` 清零的第一批公网 A 被当成最终答案并拆掉查询，缓存里的 `www.gstatic.com` 挡住随后的假 IP；PF 已武装时系统 DNS 检查失败并保持断网 | 已在 [#886](https://github.com/raydocs/tono/pull/886) 修复。auto-merge 已开一次（MERGE）。`needs-hardware` 一次 `POST` 403，未再试 |
| MAC-UPDATE-TUN-RELEASE | M10 更新 | P1（中·推导） | `AppState+Connect.swift:1469`（基线 `17580a26`） | 原生更新已标记 pending、监控尚未 suspend 时，隧道丢失走 Restore internet，放开 PF 并挡住保护重连，助手流量直连 | 已在 [#891](https://github.com/raydocs/tono/pull/891) 修复。auto-merge 已开一次（MERGE）。`needs-hardware` 一次 `POST` 403，未再试。不打开 `selectiveAiBlockReady` |
| MAC-SIGNIN-KEYCHAIN-ADOPT | M11 账号 | P1（中·推导） | `TonoAPIClient.swift:388`、`AccountSession+Auth.swift:849` | 登录成功后钥匙串写刷新令牌失败：`adopt` 把令牌留在内存然后抛出，`performAuthentication` 在写入 `user` 之前 `fail()`，会话停在 `.error`，重启后钥匙串里仍是旧令牌 | 已核实，本槽不修。#796 合入后仍故意抛出，注释写明要用内存令牌压过钥匙串里的上一账号。集成令牌不能开 GitHub issue，所以只记在这里 |
| MAC-SINGBOX-DIRECT-BLACKHOLE | M9 路由 | 决定项，不单列缺陷等级 | `ConfigPipeline+SingBoxProduct.swift:138`（基线 `17580a26`） | sing-box 中国直连是单成员 selector，注释写明没有自动回落到出口。绑定接口到不了中国目的地时，微信/钉钉和产品网页后缀失败，不是整机断网 | 接受该注释，不改代码，不改 `docs/DECISIONS.md`，不另开 issue。mihomo 侧仍有第二成员 `Tono-Exit` 的 fallback，产品连接走的是 sing-box |

集成令牌不能创建 GitHub issue。上表里未修的一项只记在本报告。

## PR

| PR | 分支 | 头 SHA | auto-merge | 标签 |
|---|---|---|---|---|
| [#867](https://github.com/raydocs/tono/pull/867) | `hunt/grok-maccfg-assistant-direct-guard-89a9` | `e4b5ca6d` | 2026-10-01 00:33 UTC 为 MERGE（raydocs 打开）。本回合没有切换 | `needs-hardware` 未打上（先前 403，未再试） |
| [#886](https://github.com/raydocs/tono/pull/886) | `hunt/grok-maccfg-dns-cache-batch-89a9` | `4f7e06b2` | 已开一次，MERGE | `needs-hardware` 未打上（一次 403，未再试） |
| [#891](https://github.com/raydocs/tono/pull/891) | `hunt/grok-maccfg-update-tun-release-89a9` | `b1fe37b2` | 已开一次，MERGE | `needs-hardware` 未打上（一次 403，未再试） |
| [#875](https://github.com/raydocs/tono/pull/875) | `hunt/grok-maccfg-report-89a9` | 本 PR head | 未开，也不开。非草稿，留给合并队列成批处理 | 无 |

## 假阳性与已排除（34）

下列都看过对应代码或对照实现，不作为新发现。

1. 当前编译进的网页/原生/微信 DNS 后缀与助手域有标签边界重叠，会 DIRECT。脚本对 `productWebDirectSuffixes`、`managedWebDirectSuffixAllowlist`、`managedNativeDirectSuffixAllowlist`、`wechatDirectDNSSuffixes` 与 `assistantHomeDomainSuffixes` 做了标签边界比较，命中数为 0。仅有的命中是原始 `hasSuffix`（`xylink.com`/`link.com`、`xhslink.com`/`link.com`、`iwencai.com`/`ai.com`、`wechat.com`/`chat.com`），见下一条。
2. sing-box `domain_suffix` 是原始字符串后缀，所以 `e.ai` 会命中 `claude.ai`。固定提交 `93fff595` 的 `NewDomainItem` 调用 `domain.NewMatcher(..., generateLegacy: false)`。无前导点的后缀存的是 `rootLabel`，只有下一个字符是 `.` 或整名相等才命中（`sagernet/sing` `7776850263cd` 的 `matcher.go`）。不是原始 `HasSuffix`。
3. `trusted=true` 会跳过受保护后缀。`validatedManagedDirectSuffix` 在跳过允许列表之前仍调用 `directSuffixOverlapsProtected`。
4. 无签名策略能替换已签名修订。`revisionOrder` 在候选未认证、当前已认证时返回 `.stale`。
5. 目录里的 `skip-cert-verify` 会进入产品运行时。`validatedOwnedNode` / Hysteria2 拒绝 `skipCertVerify == true`。`generateClashYAML` 能写出它，但订阅导入被 `AppProfile.isDev` 挡住。
6. `strict_route: false` 应该改成 true。助手契约和 helper 要求 `strict_route == false`，PF/WFP 才是保护方。
7. 没有住宅跳时，浏览器或 Claude/Cursor 的 TCP 会 DIRECT。最终路由是 `Tono-Exit`。进程名规则在没有住宅跳时也指向出口。DIRECT 的是后面的已审核应用例外，那是 MAC-ASSISTANT-DIRECT-GAP，不是这条。
8. `route_exclude_address` 含 Anthropic 网段。排除的是出口 IP 加上私网/链路本地/组播。
9. 私网 CIDR 的 DIRECT 写在助手规则前面。它写在后面，且 `160.79.104.0/21` 不是私网。
10. 钥匙串读取失败被当成登出。`currentRefreshToken` 对非 notFound 抛出，不返回 nil。
11. `enterEntitlementBlock` 拆掉保护。它停运行时，注释写明不解除 PF。
12. `generateClashYAML` 的 `GEOIP,CN,DIRECT` 是产品路径。订阅只在 `AppProfile.isDev` 下可添加。
13. 目录没有 Ed25519 签名。既有结论 X4，不重复报。
14. IPv6 出口会被当成公网地址。`normalizedServerAddress` 只收公网 IPv4，失败即拒绝。
15. Shadowsocks URL 的 IPv6 冒号切分会得到一个错误的公网 IP。切出来的主机过不了公网 IPv4 校验；产品目录走 YAML，不走这条 URL。
16. 应用侧 `UpdateContractV1.decode` 不验签名就会安装。`AppUpdater` 在下载包之前调用 helper `verifyUpdateOffer`。包下载拒绝重定向，并按清单大小核对。
17. `bounded` 在 `expectedContentLength == -1` 时不设上限。未知长度小于等于上限，随后按字节截断。
18. 假 IP 前缀 `198.19.` 配不上 `198.19.0.0/16`。`198.190.` 不以 `198.19.` 开头；范围内的地址都以它开头。
19. `cleanupIfStale` 在 `primaryNetworkService() == nil` 时留下指向死端口的系统代理。主服务对已配置但断开的服务仍非 nil；产品连接强制 TUN，不启用系统代理。
20. 系统代理绕过列表恢复不了，等于断网。产品路径不打开系统代理。
21. `parseProxyInfo` / `route` 的 `waitUntilExit` 会挂死机器。没有超时，但调用发生在系统代理守卫；产品 TUN 不走这条。管理员提示的无界等待是 #774，不重复。
22. `ProviderRuleLoader` 的路径检查有 TOCTOU。拒绝 `/`、`\`、`.`、`..` 和符号链接。本地攻击者才够得着，最多 P2，未当成用户断网缺陷。
23. 系统解析器单飞和超时后仍采用答案。超时丢弃，失败即关闭；这是已修的 N1。
24. sidecar `drain` 堵住用户网络。`homeExitEnabled` 为 false。陈旧 pid 是 #788。
25. `ControlPlanePath` 把 `not-chunked` 当成 chunked。`hasSuffix("chunked")` 确实过宽，但响应来自证书钉死的控制面。钉死不破就喂不进这个头，不能单独造成 AI DIRECT 或断网。
26. `testProxyDelay` 的查询字符集含 `&` 和 `=`。默认探测是 gstatic `generate_204`，不是用户 URL。
27. 临时端口 `SO_REUSEADDR` 竞态。毫秒级，按狩猎标准最多 P2。
28. Cursor/Code 进程规则把全部 TCP 送进隧道。文档写明的保护方向，不是泄漏。
29. Google/Apple 登录回环可被同机伪造。整文件在 `#if DEBUG` 里；回调还核对 state，且只收一个。
30. 订阅 URL 可用 `nip.io`、十进制 IP 或 IPv6 映射打到回环。`SubscriptionURLPolicy` 拦私网/CGNAT/ULA/6to4/映射地址；解析结果在 curl `--resolve` 之前再查一次。产品用户不能添加订阅（`isDev`）。
31. WebSocket 停滞会停掉核心。`onStreamStalled` 只记审计，`protection_impact` 为 `none`，并重连观察流。
32. `initialDirectPolicy` 把网页主机交给中国 DNS 却没有对应 DIRECT 路由，助手域名会泄漏。没有匹配的后缀时流量仍 MATCH 到出口。这是解析路径，不是 DIRECT。
33. `weixinbridge.com` 不在网页允许列表里，却作为产品后缀发出。它是编译进的中国站点，不是助手域。
34. 账号刷新失败会停核心并登出。旋转后的刷新令牌在钥匙串写失败时留在 `unpersistedRefreshToken`；取消不是 `fail()` 的拆保护条件。

已在 ALREADY-KNOWN 里的项（#761、#763、#765、#773、#759、#762、#755、#760、#756、#774、#782、#778、#781、#785、#788、#794、#795，以及在途的 catalog switch、token、websocket、suffix guard）没有重报。

## 计数

假设共 40。核实并修复 3（#867、#886、#891）。重复已合并 PR 1（#797）。接受为书面产品选择 1（sing-box 中国直连不回落）。已核实未修 1（登录钥匙串，见上表）。假阳性或已有守卫 34。

## 没做完的部分

- `AppState+Catalog.swift`、`AppState+Proxy.swift` 只追了直连策略装配、运行时写入和住宅终端，没有逐行读完。
- `ConfigParser` 的 YAML 中段、`TonoAPIClient` 刷新以外的请求、`UpdateHandoffJournal` 的后半段状态机，是抽样而不是通读。
- `AccountSession+Runtime` / `Telemetry` 确认了 `fail()`、权利封锁和「不解除 PF」，没有把遥测上传再猎一遍（那是 M13 / #725）。
- 10-01 对照了四个探索结果里能在当前 `main` 上读到的控制流：[Hunt M9 config routing](bc-96077312-84b3-5f2b-b850-d885dcd3ac88)、[Hunt M10 update and proxy](bc-880948d6-6334-5e38-b4d2-1f21e0a041d0)、[Hunt M11 account tokens](bc-d55b1294-044c-5bf9-bf27-7755ff8eb73b)、[Hunt M12 connectivity WS](bc-54c28811-8116-5d38-abd1-1a797a4c9948)。同一修订的目录回滚、`reloadConfig` 交接、暂停与 `startCloudOnlyRuntime` 的顺序、无名拒绝墓碑、回调内 `DNSServiceRefDeallocate` 是否安全，这几条没有在本回合重读，不计入上表。
- 公网地址和假 IP 出现在同一次最终答案里是 `containsFakeIP` 的既有契约，不另算一条缺陷。
- XCTest（助手规则、DNS 缓存批次、待更新隧道丢失）未在本机运行。
