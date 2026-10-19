# Tono 移动端交接（Android 线程 → iOS 线程）

来源：rw8/Tono-droid，Amp 线程 https://ampcode.com/threads/T-01a14a6e-7a99-745c-ab7f-888543f76c3b
状态：Android 工作区未提交（本包是快照）；Android 分支推送后会以 `feat/mobile-singbox-premium` 为准。

## 0. iOS 现状（如实）
- 本线程**没有**产生任何 iOS 分支、提交或未推送的 iOS 文件。iOS 实现尚未开始；
  raydocs/tono 的 #204（closed，分支 feat/ios-native-companion 保留）/#210（open）我未改动、未深入检查。
- 交给你的是：已选视觉方向、IA/状态/交互合同、路由合同和 sing-box 钉版，以及可直接参考的 Android 源码。

## 1. 视觉方向（已选："Horizon" + C 的触感元素）
- 参考图：design/A-horizon.png（选定）；B-tide-dial（拒：拨盘的"全部走云"档不存在于产品）；C-instrument（只借触感开关）。
- 延续桌面 0.0.75+ 海景语言：海上日出、墨蓝/梅色夜、暖琥珀/珊瑚太阳、烟熏表面、未连接时月牙、TO 标。
- Token（与桌面一致，ui/Tokens.kt）：Night #0B0D1A，NightDeep #06070F，Smoke #17151F，SmokeHigh #221F2B，
  Hairline 白 12%，Text #F7F3EE（66%/44%），Sun #FFE2A8/#FFB46A/#FF7A59，Ember #B8442E，Moon #F4EEDC，
  connected #2ED573，latency-good #30D158，warning #FF9F0A，error #FF453A，neutral #98989D，Accent #FFB46A，
  主按钮渐变 #FFD6A3→#FF9E6B，文字 #2A1406。
- 动效合同：press 100ms；state 220ms；surface 350ms；只有"到达"弹簧可过冲（damping 0.85, stiffness 120）；
  尊重"减少动态效果"。
- 延迟阈值：<200 好，<400 慢，≥400 很慢。

## 2. 信息架构 / 交互
- 首页：全屏海景（天空随状态：未连/未登录=NIGHT 月牙，准备/连接/断开=DAWN 呼吸光晕，已连=DAY 弹簧升日，
  降级=DUSK_WARNING，失败=EMBER），顶栏 TO 标 + 设置。大标题（状态）+ 一句话（live region）+ 已保护时长。
  底部烟熏面板（单手区）：原因横幅（带动作）→ SunSwitch（太阳为拇指的滑/点开关，越过阈值有刻度触感，
  提交有切换触感；无障碍上就是 Switch；引擎未跟随时 1.5s 回弹）→ 线路胶囊（延迟点、城市中文名·标签、毫秒、›）
  → 三条路线（AI 与指定服务 → Home/云；视频 → 云；其他应用 → 本地直连（三层）/云（稳定）；连接后显示探测点+出口国家）
  → 速度行。
- 线路面板：底部弹层，单选列表，"测速"按钮，缓存目录警告。线路只来自已准入的 exit catalog，不编造。
- 设置：路由模式（三层默认/稳定）、能识别与不能识别（披露）、"某网站走哪"检查、绕过 Tono 的应用（Android 专属）、
  系统 VPN 保护（always-on/lockdown；iOS 对应 On-Demand/includeAllNetworks）、账户（登出）、关于（核心版本、GPL、合同 SHA、测试版声明）。
- 登录：邮箱 → 6 位码（自动提交），与桌面同一无密码流程；服务端对非白名单邮箱同样返回 202，文案写"如果该邮箱已开通"。
- 文案：strings/values-zh-rCN/strings.xml（中文）与 values/strings.xml（英文），键名即状态/原因码，可直接复用。

## 3. 状态机（engine/EngineSnapshot.kt）
Phase: SIGNED_OUT, IDLE, NEEDS_PERMISSION, PREPARING, CONNECTING, CONNECTED, DEGRADED, DISCONNECTING, FAILED。
原因码：HOME_UNAVAILABLE(=服务端 503 CATALOG_UNAVAILABLE，绝不静默改走云)、NETWORK、RATE_LIMITED、CORE_START、
CLOUD_UNREACHABLE、HOME_UNREACHABLE、REVOKED、DENIED、SESSION_ENDED、CATALOG_ROLLBACK、CORE_STOPPED。
横幅动作：NEEDS_PERMISSION→允许；CLOUD_UNREACHABLE→换线路；HOME_UNREACHABLE→再检查；FAILED→重试。
连接后两路探测走隧道：云 https://www.cloudflare.com/cdn-cgi/trace，Home https://claude.ai/cdn-cgi/trace（解析 loc=）。
云失败或 Home 失败 → DEGRADED（匹配流量 fail-closed，普通流量照常）。

## 4. 路由合同（android/routing，纯 Kotlin，可对照移植到 Swift/Go）
- 来源：raydocs/tono@59082acf（#1671 合入后的 main）direct_domains.rs + three-tier-template.json v2，
  由 scripts/routing/sync-desktop-routing.py 生成 DesktopRoutingContract.kt（视频 21、Home 166、CIDR 160.79.104.0/21、
  受保护 39、国内精确 10、海外精确 11）。
- 规则顺序（SingBoxConfig.kt）：sniff → hijack-dns → 视频 TCP→Tono-Exit（UDP/ICMP reject）→ Home 后缀/CIDR/AI 应用包名
  TCP→Home（UDP/ICMP reject，QUIC 回落 TCP）→ 受保护剩余→Exit →（三层）海外精确→Exit → 过期 fake-IP reject →
  ip_is_private→direct → final：三层 direct / 稳定 Exit（并 reject UDP）。
  无 Home 绑定时 AI → Tono-Exit（云，绝不直连）。
- Home：homeSocks5 → socks 出站 "Tono-Home-Residential"（detour Tono-Exit，network tcp）；或 homeProxy 命名节点。
- DNS：本地后缀（local/lan/home.arpa/arpa/localhost）→ local；Home/视频/受保护 A/AAAA → fakeip(198.18.128.0/17, fc00::/18)；
  三层海外精确 → fakeip；稳定模式全部 fakeip；无全局 IPv6 时 AAAA 返回空 NOERROR；final local（底层网络解析器）。
- TUN：198.18.0.1/30, fdfe:dcba:9876::1/126，DNS 198.18.0.2，MTU 9000，auto_route，排除 LAN/CGNAT/链路本地/组播/fe80::/10/ff00::/8，IPv6 始终捕获。
- iOS 差异提示：sing-box 的 package_name 规则在 iOS 不可用（无按应用识别），AI 应用只能靠域名/CIDR；
  iOS 无按应用排除。请在 iOS 设置里如实披露。
- 校验：CatalogAdmission 与桌面 admit_node 一致（公网 IPv4、UUID 36、Reality 公钥 43 base64url、short id ≤16 偶数 hex、
  flow none|xtls-rprx-vision、tls=true、禁 skip-cert-verify、≤200 节点）；sha256=base64url(sha256(yaml))，routingSha256 配方见 Catalog.kt。
- 验证工具：scripts/routing/check-singbox-configs.sh（真实 sing-box check），engine-route-harness.py（真实内核 + stub，
  包括 Home/云挂掉时匹配流量不直连）。

## 5. 控制面 API
Base https://api.afk.ccwu.cc/api/v1/；auth/email/start {email, deviceName, installationId}→202 {challengeId}；
auth/email/verify {challengeId, code}→{accessToken, refreshToken, user, device}；auth/refresh（轮换）；auth/logout；
GET exit-catalog（Bearer）→ {revision, yaml, sha256, routingSha256, routing{homeProxy, defaultProxy, homeSocks5}}。
错误体 {error:{code,message}}；401 INVALID_OR_EXPIRED_CODE / DEVICE_LIMIT(409) / 429。
头：X-Tono-Client "<platform>/<ver>"（未知平台按缺省处理——iOS 需确认服务端接受的平台名），X-Tono-Path system_dns|relay。
中继：179.253.233.220:2053、179.255.154.17:2053、154.84.56.196:2053（TLS，SNI=API 主机）。

## 6. sing-box 钉版
v1.15.0-alpha.12，commit 25b0d5ea3e466d246c708ac0f20d0448110e566c（2026-10-11 发布；2026-10-17 核实为最新 alpha）。
上游工具链：Go 1.26.8，sagernet/gomobile v0.1.13，tags with_quic,with_utls,with_clash_api,badlinkname,tfogo_checklinkname0。
iOS 需 `gomobile bind -target ios,iossimulator`（需 macOS+Xcode）；1.15 已内置 gVisor，`stack` 选项弃用。
GPL-3.0-or-later：本身不禁止发布；App Store 分发与 GPL 附加限制的兼容性需单独核实，本轮是内部测试交付门禁，不是许可证禁令。
详见 supply-chain/sing-box/。

## 7. 包内文件
design/*.png、android/routing/**、android/mobile/src/main/{kotlin,res/values*}/**、supply-chain/sing-box/**、scripts/routing/**。
请勿把本包提交进 tono 仓库；按需移植。
