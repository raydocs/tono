# Tono 登录、引导与主页：小改动提案

只分析，本轮不改代码、不开 PR。基线是 `origin/main` `d2363002`（2026-09-30，已与远端对齐）。

用户是中文使用者，用 Tono 零配置地连上住宅出口去用 Claude 一类服务。下面只列会减少步骤、或会少让用户自己排错的问题。连接状态机、包过滤、WFP、登录失败后的自愈，都不在这份提案里。

## 先避开的在途工作

开放 PR 里，连接、开机、网络和登录失败文案已经有人在改。这些文件不要再开并行 PR：

| PR | 在改什么 | 因此不要动 |
| --- | --- | --- |
| [#706](https://github.com/raydocs/tono/pull/706) | 登录和连接失败改成短句加支持码；耗尽后放回原网络 | `login.tsx`、`tono.ts`、两端 `tono.json`、`DashboardView.swift`、`dashboard.test.tsx`、连接与传输 |
| [#697](https://github.com/raydocs/tono/pull/697) | Windows 前端 lint | `activity.tsx` 的 import |
| [#701](https://github.com/raydocs/tono/pull/701)–[#705](https://github.com/raydocs/tono/pull/705)、[#708](https://github.com/raydocs/tono/pull/708) | 开机规则、漫游、网络抖动、放行 | 任何连接或包过滤路径 |

[#706](https://github.com/raydocs/tono/pull/706) 已经明确：失败句子不再把「自己去改设置 / 换网络」写成解决办法。所以「连不上登录服务器，请开热点或另开一个翻墙」「时钟不对请打开日期和时间」「BFE 请跑 PowerShell」都不再单独立项。

## 看过的界面

macOS 没有 Xcode，SwiftUI 预览没能跑起来，结论来自源码。Windows 用仓库自带的桌面预览（`apps/windows/app/tests/desktop-preview`，Vite，中文，合成数据）截了图。预览的 `tonoConnectProgress` 永远返回一条失败记录，所以总览截图里的「当前线路未通过检查」是夹具，不是现网主页的样子。

| 屏幕 | Windows | macOS |
| --- | --- | --- |
| 引导 | 四步，可跳过。第 4 步没有正文，只有「开始使用」 | 同一套文案，`WelcomeIntroView` |
| 登录 | 邮箱 → 自动提交 6 位验证码。信任说明、发件人、60 秒重发、一分钟后的「还没收到邮件」都在 | 同一流程。设备名折叠着。收不到邮件时多一个「在 Finder 中显示诊断日志」 |
| 主页 | 连接钮、节点卡（已有延迟）、三张统计卡 | 连接钮、节点卡（已有延迟和降级角标）、流量火花线、流量弹层 |
| 暂停 | 「登录已失效 / 账号已暂停」+ 联系客服 | 暂停页能看到套餐、到期、用量 |
| 活动 | 当前会话的应用和路径色条 | 同一意图，并且按进程累计了字节 |

引导第 1 步（「继续」「跳过」都是角落里的淡色文字，主操作不显眼）：

![Windows 引导第 1 步](/opt/cursor/artifacts/screenshots/win-intro-zh.png)

登录邮箱步（这一屏本身是清楚的，不建议重做）：

![Windows 登录](/opt/cursor/artifacts/screenshots/win-login-zh.png)

空闲总览。底部「第一次连接」清单要求用户改系统 DNS、浏览器 DNS、做泄漏测试；统计卡把清单下半截挡住了。失败卡来自预览夹具，现网空闲时不一定有：

![Windows 空闲总览](/opt/cursor/artifacts/screenshots/win-dashboard-idle-zh.png)

已连接总览。按钮下方和「节点」卡片里各有一段「微信走隧道、Claude 走家里宽带」。实时流量在套接字没到时写「仪表盘还没接到核心」。失败卡同样是夹具：

![Windows 已连接总览](/opt/cursor/artifacts/screenshots/win-dashboard-connected-zh.png)

活动页已经能把 Claude 和微信分开，并标出直连 / 家宽 / 云端。这是色条和连接数，不是字节，也不是配额：

![Windows 活动页](/opt/cursor/artifacts/screenshots/win-activity-zh.png)

登录已失效。只有重新登录、退出、把一段诊断复制给客服。套餐是否到期，这一屏看不出来：

![Windows 登录已失效](/opt/cursor/artifacts/screenshots/win-login-suspended-zh.png)

## 屏幕上真正的问题

按「用户少走一步 / 少被要求自己修」排序，不是按好不好看。

1. **第一次打开要先看完四页，最后一页是空的。** 两端都是：保护、断网不泄漏、线路不用配、然后一个没有正文的「开始使用」。可以跳过，但「跳过」和「继续」都是角落里的淡色链接（见引导截图）。零配置产品的第一件事应该是邮箱。
2. **Windows 空闲主页先布置家庭作业。** `ConnectChecklist` 在未连接且没有操作错误时出现，四条分别是：安装时点管理员、关掉 Windows 加密 DNS、改 Chrome/Edge 安全 DNS、连上后到支持页做 WebRTC 测试。用户还没点连接。预览里这张卡还被底部三张统计卡挡住。加密 DNS 只有在本机真的开着时才值得提一句，不该做成每次都在的清单。
3. **连上之后，主页用一段路由说明当状态。** Windows 已连接时，`directOn` / `directSkipped` 出现两次：按钮底下一次，「节点」统计卡里再一次。用户要的是「保护开着」。规则明细已经有「查看规则」。
4. **macOS 流量弹层的「今天 / 本月」不是今天，也不是本月。** `DataUsageSummaryView` 把本次连接的 `trafficStats` 标成 TODAY。本月下载是 `max(todayDown, todayDown)`，永远等于今天。本月上传拿的是账本里的总字节，上传和下载混在一列。账本在每次连接时 `reset()`。这是错的数字，不是缺一张图。
5. **主页看得到速率，看不到这次用了多少。** 两端主页的「实时流量」是当前 B/s。macOS 合计藏在那个标错的弹层里。Windows 流量套接字已有 `upTotal` / `downTotal`，主页没用。Windows 内存里还有大约 60 分钟的速率采样（`use-traffic-monitor`），主页也没画。macOS 主页在已连接时已有一条约 60 秒的火花线。
6. **账号被停住时，Windows 不告诉用户为什么。** `tono-core` 的 `User` 已经解析了 `plan`、`quotaBytes`、`usageBytes`、`expiresAt`。交给界面的 `TonoAccountInfo` 只留邮箱、是否暂停、设备上限。macOS `AccountBlockedView` 会显示套餐、到期和用量。Windows 这一屏只说联系客服或重新登录。
7. **macOS 验证码没到时，把用户送进 Finder。** `SignInCodeNotReceivedHint` 在「核对垃圾箱、复制详情」之外还有「在 Finder 中显示诊断日志」。Windows 同一情境只要求核对地址和垃圾箱。
8. **macOS 第一次选语言一定会退出再打开。** 选简体中文、英文或跟随系统都会 `relaunch()`。保护没武装时退出本身是快路径，但应用还是会消失再出现，然后才进入四步引导。系统语言已经是所选语言时，这次退出没有必要。

登录邮箱步、验证码自动提交、60 秒后才能重发、一分钟后才出现「还没收到邮件」，两端已经对齐，不建议为了「再顺一点」去改。设备名在 macOS 上是折叠的，默认用电脑名，不必拆掉。

节点名和延迟两端主页都有（Windows `exitDelayMs` / TCP 延迟，macOS `latency(forNodeNamed:)`）。macOS 出口无响应时主页角标会变成「保护中，出口不稳定」。这些不用重做。

## 客户端已经有的数据

都不需要新的探测，也都不该为此改隧道。

| 想显示的 | macOS | Windows | 现在给用户看了吗 |
| --- | --- | --- | --- |
| 当前上传/下载速率 | `trafficStats` 速度；主页火花线约 60 秒 | 流量套接字 `up`/`down`；采样器里约 60 分钟曲线，主页没画 | macOS 主页有速率和火花线。Windows 主页只有一个速率数字 |
| 这次连接的字节合计 | `trafficStats.totalUpload/Download`；账本按进程、按直连/家宽/隧道累计，连接时清空 | 套接字 `upTotal`/`downTotal`。Rust `route_ledger` 按云端/家宽/直连累计字节，但没有进程名，也不上主页 | 没有诚实的「本次」合计。macOS 弹层把它叫成今天/本月 |
| 按应用的家宽流量 | 账本有进程名和 residential 字节 | 活动页只有当前连接的路径色条。单条连接的 `upload`/`download` 在连接流里，界面没有按应用累加 | 活动页能看出 Claude 走哪条路，看不出用了多少 |
| 今天 / 近 7 天 | 没有落盘的按日合计。进程内 `cumulative` 是给遥测窗口做减法的，退出就没了 | 同左，`route_ledger.overall` 只活在本次进程 | 没有 |
| 已连接多久 | 账本有 `startedAt`，主页没用；连接时会重置 | 状态里没有「连上于」 | 没有。不要用进程启动时间冒充 |
| 当前节点和延迟 | 节点卡 | 节点卡，优先出口延迟，其次 TCP，再次缓存 | 有 |
| 线路是否还健康 | `isProxyDegraded` 会改变主页角标 | 健康检查在支持页，主页没有对等的「出口无响应」 | macOS 有，Windows 主页没有。不要为了这个新加探测 |

已有遥测会在用户同意后上传按路径汇总的字节。新的按应用、按 AI 服务的数字应留在本机，不要并进那条上传。

## AI 用量：对照 OpenUsage，v1 怎么做

[OpenUsage](https://github.com/robinebers/openusage)（菜单栏，Swift，MIT，macOS 15+）显示的是订阅配额，不是流量。Claude 的 5 小时窗口和 7 天窗口来自 `GET https://api.anthropic.com/api/oauth/usage`，凭证读的是本机已经登录的 Claude Code 钥匙串、`~/.claude/.credentials.json` 或 Claude Desktop。它会把刷新后的 Claude Code token 写回去。今日/昨日/30 天花费来自本机会话日志（`~/.claude/projects` 等），按公开模型价格估算，日志不出本机。Cursor、Codex、Copilot 也是读本机已有登录或本地库。OpenRouter、Z.ai 要用户自己贴 API key。它另有一个只监听 `127.0.0.1:6736` 的本地 API，不吐出凭证，但本机网页也能读到用量。它还会发匿名日活和崩溃报告，额外分析默认开启。ChatGPT 网页版配额在同类工具里仍不完整。来源：[README](https://github.com/robinebers/openusage)、[Claude 提供方说明](https://github.com/robinebers/openusage/blob/main/docs/providers/claude.md)、[隐私说明](https://github.com/robinebers/openusage/blob/main/docs/privacy.md)。

对 Tono：

- **配额和流量不是一回事。** 家宽上多了 40 MB，推不出 Claude 还剩百分之几。把字节画成「今日额度」是假的。
- **读用户的 Claude/Cursor token 不适合做进 Tono。** 那些 token 能调用模型，Claude Code 的刷新还会写回用户的登录文件。Tono 一旦读错或写坏，用户会以为是梯子把 Claude 登出了。贴 API key 也违背零配置。
- **可以完全在本机做，且不碰隧道。** 用已经存在的连接采样做差，按现有活动页的路径分类累加。不新开一条出站，不改路由，不把结果发给控制面。采样本来就会走，界面只是多记一笔。
- **不要去连 OpenUsage 的本地 API 当作 v1。** 那是 macOS 独有、要另装一个应用，而且任何本机网页都能读。Windows 用户没有这条路。

**v1：** 主页一张卡，「今天走家宽的 AI 流量」。只加总已有名单里的进程：Claude、Claude Code、ChatGPT、Cursor、Grok（活动页翻译表里已经有这些名字）。单位是 MB，文案写「流量，不是剩余额度」。按本地日期落在本机，退出再开还能看见今天和近 7 天。没有这些进程时显示「今天还没有」，不要显示 0% 或者「未登录」。默认就这张卡，没有开关页，没有 token，没有设置。macOS 可以直接加总现成账本。Windows 要用连接流里已经有的 `upload`/`download` 做同样的差量，分类与 `activity-model.ts` / `route_ledger` 保持同一套规则。

不做：配额百分比、重置倒计时、花费美元、读取钥匙串、要求用户登录 Claude、把按应用的用量上传。

## 建议的小 PR

每一项都不改连接怎么建立、怎么拆、怎么放行。和 #706 撞文件的，标了顺序。

### 1. 引导收成一屏

- **影响 / 工作量：** 高 / 小。第一次打开少点三次，主按钮看得见。
- **范围：** `WelcomeIntroView.swift`、`intro.tsx`、`intro.test.tsx`。三句现有文案放在同一屏，一个实心「开始使用」。保留跳过。macOS 圆点不要再 `accessibilityHidden`。不改 `introSeen` 的含义，不改登录守卫。
- **界面：** 两端首次引导。
- **连接风险：** 无。
- **效果：** 现在是左文右图、右下角淡色「继续」、四颗点（见引导截图）。改完仍是这一张版式，正文换成三行短句，右下角变成和登录页同色的按钮，没有第 4 页。

### 2. 拿掉 Windows 空闲主页的「第一次连接」清单

- **影响 / 工作量：** 高 / 小。未连接时不再要求用户改 DNS 或做泄漏测试。
- **范围：** 只改 `dashboard.tsx` 里 `ConnectChecklist` 的渲染。本机已经探测到加密 DNS 开着时，保留现在那一张单独的提示（那是测量结果，不是清单）。不要改 `tonoConnect`、不要改进度卡。
- **界面：** Windows 总览，未连接。
- **连接风险：** 无。
- **顺序：** `dashboard.test.tsx` 在 #706 里。测试若断言这张清单，等 #706 合并后再改测试。
- **效果：** 空闲截图中间那张四条清单消失，底部三张统计卡不再压住它。连接钮和「选好节点，点连接」留着。

### 3. 主页状态改成一句话

- **影响 / 工作量：** 中 / 小。连上之后不再读两遍路由说明。
- **范围：** Windows `dashboard.tsx`：按钮下和「节点」卡的说明改用已有的短句（`taglineConnected`：「流量已保护；断线不会漏 IP。」）。`directOn` 留在「查看规则」里。不新增文案键，避免和 #706 的语言文件冲突。macOS `DashboardView.swift` 等 #706 合并后再看还有没有同样的长文案。
- **界面：** Windows 总览，已连接。
- **连接风险：** 无。只改显示哪一句。
- **效果：** 已连接截图里，按钮下和左下统计卡各有的那段「微信 / Claude / Cursor」合成一句「流量已保护」。节点卡继续显示城市和延迟。

### 4. 修正 macOS 流量弹层的标签

- **影响 / 工作量：** 中 / 小。不再把一次连接的字节叫成「今天」和「本月」。
- **范围：** `DataUsageSummaryView.swift` 以及它在主页的调用。列名改为「本次连接」。删掉本月列，直到有真正按日落盘的数。补一个测试，锁住「下载列不能拿总字节冒充」。
- **界面：** macOS 总览，点击「实时流量」。
- **连接风险：** 无。不改账本怎么累计。
- **效果：** 弹层从「方向 / 今天 / 本月」变成「方向 / 本次连接」三行：上传、下载、合计。数字仍是现在的 `trafficStats`。

### 5. 主页写出本次流量，Windows 补上已有的速率曲线

- **影响 / 工作量：** 中 / 中。用户能回答「刚才用了多少」，不用打开活动页。
- **范围：** Windows 主页「实时流量」卡加上套接字里已有的 `upTotal`/`downTotal`，并画出 `use-traffic-monitor` 里已有的采样。macOS 在第 4 项的「本次连接」之外，不必再造一条曲线（火花线已经在主页底部）。采样中断时继续用现在的「正在读取流量…」，不要显示 0 B/s。不新开 WebSocket，不改核心。
- **界面：** Windows 总览底部三张卡里的「实时流量」。
- **连接风险：** 无。
- **顺序：** 若要改 `dashboard.test.tsx`，放在 #706 之后。
- **效果：** 那张卡在速率下面多一行「本次 ↑ 12 MB · ↓ 86 MB」，卡内一条与 macOS 底部类似的细火花线。未连接仍是「空闲 / 当前没有活动线路」。

### 6. Windows 账号卡显示已经解析好的套餐事实

- **影响 / 工作量：** 中 / 小。暂停或快到期时，用户不用先问客服自己的套餐到哪一天。
- **范围：** `TonoAccountInfo` 把 `plan`、`quotaBytes`、`usageBytes`、`expiresAt` 传出去（`User` 里已有）。`TonoAccountCard` 多三行：套餐、用量、到期。没有这些字段就不画，不要写「未知」让用户去查。登录页的暂停卡等 #706 合并后再接同一段，避免现在改 `login.tsx`。
- **界面：** Windows 账号页。暂停登录页随后。
- **连接风险：** 无。不改暂停判定，不改登出会不会拆保护。
- **效果：** 账号卡在邮箱下多「套餐 / 已用 / 到期」。登录已失效那张卡以后也可以用同样三行，而不是只有「请联系客服」。

### 7. macOS 收不到验证码时，不要打开 Finder

- **影响 / 工作量：** 中 / 小。少一步「去文件夹里找日志」。
- **范围：** `AccountGateSupport.swift` 的 `SignInCodeNotReceivedHint`。留下「核对垃圾箱和地址、复制详情」。去掉「在 Finder 中显示诊断日志」。不改验证码请求。
- **界面：** macOS 验证码步，发送满 60 秒仍无邮件。
- **连接风险：** 无。
- **效果：** 和 Windows 登录截图同一节奏：地址、发件人 `Tono <login@lecvia.com>`、垃圾箱、复制。没有 Finder。

### 8. 语言已经一致时，macOS 不要为了选语言退出重开

- **影响 / 工作量：** 低到中 / 小。系统已是中文的人少一次冷启动。
- **范围：** `LanguageSetupView` / `InterfaceLanguagePreference`。当前 `AppleLanguages` 已经等于所选语言时，只记下「已经选过」，不调用 `relaunch()`。语言真的要变时，保持现在的退出重开。不改 `terminateForRelaunch`，也不碰已经武装的保护。
- **界面：** macOS 第一次的语言页。
- **连接风险：** 无。这条路径只在还没有会话、用户主动选语言时发生；武装中的退出逻辑不动。
- **效果：** 系统已是简体中文时，点「简体中文」直接进入引导（或第 1 项之后的那一屏）。点另一种语言时，仍会退出再打开。

### 9. 主页「今天的 AI 流量」卡（v1）

- **影响 / 工作量：** 中 / 中。回答「今天 Claude 走了多少家宽」，不冒充配额。
- **范围：** 新的只读卡片。数据来自第 5 项之前就已经存在的连接采样：macOS 用 `AppTrafficLedger`，Windows 用连接流里的字节差量，进程名单用活动页已有的 Claude / Claude Code / ChatGPT / Cursor / Grok。按本地日累加，写在本机，不上传。文案固定为流量。空状态是「今天还没有」。不读钥匙串，不要 token，不请求 `api.anthropic.com`。
- **界面：** 两端总览，连接钮和节点卡之下。不放进连接进度卡。
- **连接风险：** 无。不增加出站，不改分类规则的判定（只调用现有分类）。
- **顺序：** macOS 若要放进 `DashboardView.swift`，等 #706 合并。也可以先做成活动页顶部的一张摘要，完全不碰主页和 #706。
- **效果：** 一张卡，标题「今天的 AI 流量」，副标题「家宽上的流量，不是剩余额度」。五行：Claude、Claude Code、ChatGPT、Cursor、Grok，每行一个 MB 数；下面七个小柱表示近 7 天合计。没有用量的行不出现。

## 明确不做

- 不重做登录版式。邮箱步已经是一步。
- 不改 #706 正在改的失败短句、支持码、耗尽后放行。
- 不在主页增加「已连接时长」，除非状态里已经有「连上于」。用进程启动时间或「这次打开应用」会在重开后撒谎。
- 不把字节画成 Claude/ChatGPT 的剩余百分比。
- 不读、不刷新、不保存用户的 AI 订阅 token。
- 不改连接、包过滤、节点选择、hy2。
