# W1-grok-mac-config（2026-09-30）

Hunter: Grok 4.7。范围：macOS M9 配置与策略签名、M10 代理/更新/订阅/线路、M11 账号与钥匙串、M12 连通性/sidecar/WebSocket。基线 `origin/main` `50bbbbf0`。不部署、不跑 jev-route。Swift XCTest 在这台 Linux 云代理上不能跑（没有 `xcodebuild` / Swift），未安装工具链。

## 结论表

| ID | 区域 | 严重级别 | 文件:行 | 一句话 | 结论 |
|---|---|---|---|---|---|
| MAC-ASSISTANT-DIRECT-GAP | M9 路由 | P1（中·推导） | `ConfigPipeline+SingBoxProduct.swift:157`、`ConfigPipeline+Runtime.swift:691`（基线 `50bbbbf0`） | 没有住宅跳时不发出助手域名/`160.79.104.0/21` 规则，已审核应用的进程直连先匹配，TCP 直出物理网卡；有住宅跳时这些规则只覆盖 TCP，同一进程的 UDP 仍直连 | 已在 [#867](https://github.com/raydocs/tono/pull/867) 修复。auto-merge 已开，合并方式 MERGE。`needs-hardware` 标签两次 `POST` 均 403（集成令牌不能改标签），未打上 |
| AI-DIRECT-SUFFIX（在途） | M9 策略 | 不新开等级 | `ConfigPipeline+Direct.swift` `directSuffixOverlapsProtected` | 受保护后缀列表没有 OpenAI 等助手域，签名策略仍可能写入这些后缀 | 重复 #797（`codex2/ai-direct-suffix-guard`，进行中）。本槽不改该校验。#867 让路由规则先于后缀直连，但 DNS 仍可能把被接受的后缀交给中国 DoH，那部分留给 #797 |

没有已核实、又决定不修的缺陷，因此没有新开 GitHub issue。

## PR

| PR | 分支 | 头 SHA | auto-merge | 标签 |
|---|---|---|---|---|
| [#867](https://github.com/raydocs/tono/pull/867) | `hunt/grok-maccfg-assistant-direct-guard-89a9` | `e4b5ca6d` | 已开，`mergeMethod=MERGE` | `needs-hardware` 未打上（`gh api` 403 `Resource not accessible by integration`，重试一次仍 403） |
| 本报告 | `hunt/grok-maccfg-report-89a9` | 见该 PR | 文档 PR，auto-merge + merge commit | 无。不是 UI，也不是路由改动 |

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

假设共 36。核实并修复 1（#867）。重复在途 PR 1（#797）。假阳性或已有守卫 34。

## 没做完的部分

- `AppState+Catalog.swift`、`AppState+Proxy.swift` 只追了直连策略装配、运行时写入和住宅终端，没有逐行读完。
- `ConfigParser` 的 YAML 中段、`TonoAPIClient` 刷新以外的请求、`UpdateHandoffJournal` 的后半段状态机，是抽样而不是通读。
- `AccountSession+Runtime` / `Telemetry` 确认了 `fail()`、权利封锁和「不解除 PF」，没有把遥测上传再猎一遍（那是 M13 / #725）。
- 上一轮派出的四个探索子代理在上下文压缩后没有可核对的结论；本报告只采用这次直接读到的代码和 sing-box 匹配器。
- XCTest `testAssistantDestinationsPrecedeReviewedBundleDirectWithoutAHomeHop` 未在本机运行。
