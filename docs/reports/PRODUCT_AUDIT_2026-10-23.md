# Tono 完整产品审计与优化路线图 · 2026-10-23

## 结论与边界

Tono 已有路由、特权保护、账户隔离和恢复机制；当前最需要补齐的不是更多功能开关，
而是**旧系统兼容、异步恢复正确性、跨端契约一致、保护状态可信，以及可重复的交付验收**。
本轮已经进入实际修复，不把“审计完成”算作“产品通过”。

- 冻结审计基线：`0465af8140d0fc91148fd3f356b8a9e819d71f76`。
- 用户范围：Windows、macOS、**通用 Android**；没有承诺小米/华为/三星等 OEM 适配或真机覆盖。
- Sonnet 5.5：Android 生命周期；Opus 5.5：macOS Core/helper/保护；Fable 5.1：三端体验；
  GPT-6.1-Sol：Windows 连接恢复；Grok：跨端 API、诊断和交付。五份初审均为独立只读源码审计。
- 首批实现后另做 Sol/xhigh 精确 diff 审查；它与五份基线报告、CI、设备验收互不替代。
- 本文是阶段性结果和剩余工作，**不是发布许可**。没有生产部署、客户频道发布或 owner G1/G2/G3 勾选变更。
  新的代码 SHA、包哈希、签名、主机和测试场景要分别记录，不能继承旧版本的整机资格。

## 实际优化与交付状态

2026-10-23 合入状态复核基于 main `57dc80e73`；下列“已合”只指源码，不代表设备/签名/发布资格。WMI/Android 新增进展单列为未合入，不借用 main 的资格。

| 修复 | 原问题与最小改动 | 已有证据 | 交付状态与剩余验证 |
|---|---|---|---|
| Android 10/11 启动权限 | `NetworkMonitor.requestNetwork` 缺正常 `CHANGE_NETWORK_STATE` 权限；仅补声明及真实 instrumentation 回归，不改 consent/路由 | [#1726](https://github.com/raydocs/tono/pull/1726)：API29/30 旧 APK 各 1 次真实 `SecurityException`；修复 `8a3ba2cc7` 在 API29/30/34 各 `OK (1 test)`；独立审查通过 | 已合 main `f8b673518`；交付 head ci-gate 与独立 android-ci 均通过。仍待真机、其他 API 层及发布资格 |
| macOS 保护范围文案 | AI Home 默认并非全主机保护；按实时会话而非下次连接设置显示 AI 范围，限定规则外 DIRECT，防止详情在连接尾段过早报保护 | [#1724](https://github.com/raydocs/tono/pull/1724)：原回归 RED 为 `Protected != AI protected`；过渡态回归在旧实现报过早保护而失败；最终 `f32fcf93b` ci-gate GREEN、两轮独立审查完成 | draft，未合 main；等待人工视觉验收。末轮剩余 retry 徽章/指标不同步 minor 已单列，不能称全状态一致 |
| Windows 迟到失败清理竞争 | 旧 A 的 adapter 读取结束后可能清掉已成功 B 的认证 fallback port；清零移至持同一 state mutex 的 generation-owned 提交 | [#1725](https://github.com/raydocs/tono/pull/1725)：原/修复代码使用同一主动 EOF fixture；旧版在真实端口断言失败；`96125d828` ci-gate GREEN、772 项通过；最终独立审查通过 | 已合 main `3e8fa876a`，最终交付 head CI 通过；仍待 Win10/11 真机。原两次 fixture 超时未被计作 RED/GREEN |
| Android POST 歧义重放 | 验证码/refresh 请求可能已送达但丢响应，旧客户端仍换路径重放；首次 HTTP write **之前**标记歧义，保留 GET 和写前回退 | [#1728](https://github.com/raydocs/tono/pull/1728)：`b97d55c28` 同一回归 RED/GREEN；routing18、mobile103 passed / 25 skipped，lint 通过；独立审查通过 | 已合 main `ca40f3baa`，最终 ci-gate/android-ci 通过；仍待实际公网 TLS 故障/设备验证，未改 iOS |
| macOS 新登录的孤儿 AI Home 会话 | 只在新认证、当前空闲归属、authenticated broad false + fresh selective false 时清内存/磁盘记录；保留真实/未知 hold | [#1730](https://github.com/raydocs/tono/pull/1730)：旧行为在 `ai-home != stable` 断言 RED；最终 head `8ea8c3a71` CI39942446548 GREEN，758 tests/1 skipped/0 failures，独立 R1 approve | 已合 main `91d9b9bed`；仍待安装机账户切换/冷启动/真实 helper hold；不授权自动替换仍持有的 AI 保护 |
| Windows Restore 在途 WMI | 隔离后立即杀 writer 可能留下本次开机无法安全退休的批次；新增精确进程实例单向封闸与共享最多 10 秒排空，未知/超时不新增退休证明 | [#1733](https://github.com/raydocs/tono/pull/1733)：RED39963653880 在真实顺序断言失败（642 pass/1 fail）；源码 `1d24786a8` GREEN39965161786，Service643/0、生产 build/native DNS 通过；Sol/xhigh R1 approve | **draft，未合入**；最终 head `fecaa41d9` exact CI39973037208 GREEN，源码未变。跨进程锁/ACL/SCM/混装/Win10/11 安装机验证待做，禁用自动合并 |
| Ops 间接 Next 依赖 | 仅将 Geist 引入的 Next-family lock 条目16.4.0→16.4.2，不改字体和 Vite 应用逻辑 | [#1729](https://github.com/raydocs/tono/pull/1729)：442 tests、typecheck/lint/build/预算通过，字体 hash 不变；npm audit critical1→0，exact-head CI39938624059 GREEN | 已合 main `acafd91c5`；未部署，不声称已复现线上 Next 漏洞 |
| Pillow 图标工具依赖 | 12.3.0→13.0.0；更新 Python≥3.11 前提，不重新生成已审定资源 | [#1731](https://github.com/raydocs/tono/pull/1731)：两版本各5 tests；21图像样本/帧和编码结果相同，149个 tracked 资源 hash 未变；exact-head gate39943798978 GREEN | 已合 main `e93dc5ba6`；仍未做其他 OS 的 wheel 运行/全量生成或漏洞利用验证，平台 CI 的跳过不冒充 Pillow13 运行 |

Android 权限验证使用[同一 Devin Linux KVM 会话](https://app.devin.ai/sessions/e8291010a8af4c30937075dd4faca3eb)：
同一个 instrumentation APK（SHA256 `b0753ac75140a4e36c7c8c9e8957bff25914ea282c042dae00afaca8e36d00fe`）
在旧/新应用 APK 上运行；新版 app SHA256 为
`0209e7078f24151c1a97bd5127d7c9755c78e28b545f225ed5e04f9dbf3f02fd`。
三个 API 的未登录真实 service 创建均不再出现权限崩溃，仍报告 SIGNED_OUT、非已连接。
routing JVM 18 passed，mobile JVM 102 passed / 25 默认截图 opt-in skipped，lint 通过。
API30 网络预检有一次环境重试，固定 APK 的回归均一次通过；没有把跳过或环境失败藏成通过。
文档追加后的交付 head `71d6bdf40` 与云端 `8a3ba2cc7` 的产品及 workflow 树相同。

macOS 原 RED [39919244126](https://github.com/raydocs/tono/actions/runs/39919244126)、初始 GREEN
[39919786180](https://github.com/raydocs/tono/actions/runs/39919786180)；过渡态 RED 源码 `96f4ecb9f`
的 [39921409612](https://github.com/raydocs/tono/actions/runs/39921409612) 已在四个文案断言失败；最终 GREEN
[39921670825](https://github.com/raydocs/tono/actions/runs/39921670825) 已通过（精确 head `f32fcf93b`）。
Windows 修正后的 RED `08c9854de` 在 [39922890390](https://github.com/raydocs/tono/actions/runs/39922890390)
实际失败于端口保留断言；GREEN [39922905155](https://github.com/raydocs/tono/actions/runs/39922905155)
执行 Tauri 772 项全部通过，包含新回归和 ownership/caller-abort 同伴。
最后文档收尾后的 macOS `8462be883`、Windows `9e7f7940d`、Android POST `23e59122f` 与
各自被测试/独立审查的产品树相同；交付 head CI 已单独核对，未借用旧 head 的绿灯。
Windows最终 ci-gate39924831373、Android权限 ci-gate39923389377 + android-ci39923389271、
Android POST ci-gate39924688931 + android-ci39924688829 均成功且匹配对应交付 SHA。
macOS保护范围 #1724 仍是 draft，等待人工视觉验收；准确状态及未运行项保留在各 PR verification comment。

## 剩余问题：先修可靠性，再扩功能

下列候选来自静态审计，不是全部已复现。已有 ledger ID 的继续沿用，未复核的不能标 fixed。

### Windows

1. **P2，既有 `WIN-RESTORE-ABANDONS-INFLIGHT-WMI`**：Restore 中断持有在途 WMI DNS 批次的
   Service，可能使当前开机的账本无法安全退休。应先 fence 新写入，再对仍存活且归属可证的写入做
   有界 cooperative drain；未知/超时仍保留拒绝和重启恢复。**不能按等待时间或 PID 已死删除账本**。
   该方案已在 #1733 实现，取得同一回归的真实 RED/GREEN、原生构建与精确差异独立审查；最终 head `fecaa41d9` CI 通过。仍为 draft，跨进程/安装机验收未过；不要重新实现或把旧 abandoned 账本当作可按超时删除。
   验收：冻结真实批次返回点的顺序回归，Win10/11 普通/管理员用户的 Service 进程边界验证。
2. **P2，既有 `WIN-RESUME-RECEIPT-RACE`**：Service 保留 Core 与 App 二次采样之间有竞争，
   可能误报自身 `:53` 为外部 DNS 冲突。方向是带 owner/attempt/Core 身份、兼容旧 Service 的保留回执，
   不是跳过 DNS 或完整连接验证；先定义 IPC 兼容契约，再做新旧 Service 配对测试。
3. **P2，既有 `WIN-MISSING-UPLINK-GRACE` / `WIN-DIRECT-BINDING-UNPROVEN`**：休眠后缺上行与
   系统 API 无回答是不同状态；有限宽限不得掩盖 Core/WFP/DNS/归属故障，不得因为超时放开保护。
   验收：Wi-Fi 恢复慢、网卡禁用、换网、休眠和恢复网络并发；每个分支给出可取消的用户状态。
4. `WIN-DNS-RACE-MASKS-SYSTEM` 等源码/PR/ledger 状态存在时间差；先对齐已合源码，不重新实现
   #1720 或修改他人的 #1643/#1668 安装器/恢复工作。

### macOS

1. **P2，末轮新增 `MAC-DASHBOARD-RETRY-STATUS-SKEW`**：自动重连成功尾段，徽章/指标可能先报
   AI 已保护，详情/菜单仍等待重试。没有证明保护已释放或泄漏；按两轮停止规则记录 open，不再无限审查。
2. **P3，账户与会话记录已做有界修复**：#1730 已合 main，回归及独立审查证明新认证可退休已证实无保护的孤儿记录。
   真正持有/未知 selective hold 仍保留 AI Home，不能因新账号无 Home 自动释放；安装机跨账号和冷启动资格仍待补。
3. **P3 候选，退出后的 AI 保持承诺**：设置说明需区分会话内 PF 与退出后 best-effort selective hold，
   不能把 `/23` 的尽力层宣称为所有已列 AI 域名或会话 `/21` 的同等保证。先核对实际规则覆盖与 owner 契约，
   再同步双语文案；不在文案修复里扩大/削弱 PF。
4. **既有 `MAC-WAKE-GATE-RACE`**：用同机单调时间定位 App didWake 与 helper 电源门时序；只有
   编码明确的 power-transition 拒绝才考虑短、有界、可取消的重试，不提前开门。

### 通用 Android

1. **P2 候选，后台终止的通知闭环**：always-on/自动恢复遇到未登录、consent 丢失、session ended、
   Core 启动失败或 onRevoke 时，不是所有路径都有 stopped 通知。lockdown 下可能断网却没有解释。
   先列“用户主动停止 / 系统撤权 / 可恢复失败”的状态表，通知不能误称系统一定放开网络；需允许/拒绝通知权限两组。
2. **P2 候选，Wi-Fi/蜂窝与 underlying network**：`BoxPlatform` 仅建 TUN 时设置 underlying network，
   后续 `NetworkMonitor` 变化是否同步到 VPN 的 transport/metered 属性需用 `dumpsys connectivity` 验证。
   修复要与 TUN 所属代次和销毁绑定，不能把旧回调写入新 VPN。
   已有 WIP 源码 `316887d2a` 及独立 R2 approve；没有可接纳的编译/JVM/lint/行为 RED/GREEN，仍未开 PR/合并。
   两个既有 Devin 会话暂停于额度不足；不新建付费 VM，不把 consent/环境失败算作行为 RED。
3. **P2/P3 候选，无上行与失败意图**：cached catalog + 离线不应无限停在 Connecting；Core 启动失败后
   `wantConnected` 的保留/清除需按自动恢复意图定义，避免之后意外重连。验收包括取消、服务重建和无网络预算届满。
4. **P2，跨端首连契约**：`503 EXIT_IDENTITY_PROPAGATING` 在移动端按失败结束，桌面有有界等待。
   WIP `2c8dfd966` 已加仅目录 GET 明确错误码驱动的等待/取消/固定截止；首次信号起最多 5 分钟、15 秒重读，独立于在途 IO，排队发送前复核归属，POST 分类隔离。RED 源码 `f537965b1` 与 FIX 的 engine/UI 测试逐字节相同，但**尚未编译或执行行为 RED/GREEN**，独立 R1 已完成并指出 P2：休眠跨时钟且 IO 无返回时，原相对定时器可能推迟复核；正在作局部修正，不能称预算已验证。仅 WIP refs，无 PR；既有 Devin 额度阻塞，未新建付费 VM。不能因源码已写而标 fixed。
5. **P3，体验一致性**：consent 前说明按实际模式；Stable 的 degraded 不应沿用“部分可用”而不说明范围；
   增加重发验证码与冷却/无障碍反馈。先协调 #1722/#1723 的 settings 改动，不覆盖其文件。

## 跨端产品完整性与升级机会

- **诊断身份**：控制面 `client-identity.ts` 仅接受 macos/windows，Android 的 `android/<version>` 被视为缺失。
  迁移0092 的 `devices.client_platform` 还带 desktop-only CHECK，仅改 parser 会在 best-effort catch 中继续丢记录。
  支持移动 platform 前需一起核对 DB、设备列表、统计和隐私边界；不能直接开启未经设计的诊断上传。
- **契约测试**：统一错误码分类、写前/歧义送达边界、refresh 单飞/账户代次、目录传播和取消语义。
  用同一场景规范各端独立回归，不强行共享生命周期实现；iOS 同类重放风险单列后续，不算本轮已修。
- **交付**：Android 仍 debug/internal-only，单独 android-ci 不属于 ci-gate，是当前交付边界，不能当漏配直接改必需门。
  正式发布前要有签名持有/恢复、版本防回退、来源验证、安装升级、渠道和隐私/数据删除契约；当前没有批准开新发布通道。
- **依赖**：初始 GitHub API 历史快照 44 个告警：Next 3、图标工具 Pillow 39、glib 2（不是现在的未修数量）。
  Next 16.4.0 的修复指向 16.4.1，但 ops-console 实际是 Vite，不可把间接 Next 告警说成线上 Next 服务已可利用。
  Pillow 为资产生成工具；升级先做隔离回归，不重新生成所有已审定图标。glib 先核对 Windows 构建可达性。
  告警数不是独立线上漏洞数。Next/Pillow 已分别通过 #1729/#1731 合入修复 pin。随后 API 实查剩余两个 open 告警均为两份锁文件中的同一个 glib0.18.5 advisory；
  [精确锁定包的目标条件核对](DEPENDENCY_TARGET_REACHABILITY_2026-10-23.md)显示所有 GTK 入口仅面向 Linux/BSD，未把它说成已复现 Windows 漏洞。没有强升不兼容 glib、删锁条目或 dismiss；仍缺 hosted target 解析图/产物证据。
- **可访问性**：macOS/Windows 的大字号、键盘、VoiceOver/Narrator、减少动态效果和焦点恢复缺当前实机证据。
  Android 已有历史大字号 emulator 证据，但不是本轮新 SHA 或所有手机屏幕的通过证明。
- **可测性与性能**：状态优先级做实际视图共用的投影；并发回归用受控事件而非 sleeps。
  测量连接 p50/p95、恢复时间、CPU/耗电、安装包大小，记录网络与硬件分层；不在测量前承诺百分比提升。
- **文档**：SHIP_PLAN 是有日期和版本的 owner gate；RELEASE_READINESS、已合 PR、ledger 和候选证据需定期对齐。
  不把旧 0.0.75 的 owner 勾选移到新源码，不把文档陈旧当作随意改发布条件的理由。

## 不采纳的“优化”

- Opus 的“国内直连存活时自动换云出口”建议**不直接实施**：`CatalogCityFailover.shouldRotate` 故意为 false，
  源码明确等待 G2.8 家宽证据。降级无自愈是待决策的可用性问题，不授权重开自动换城。
- 不为了兼容放宽 TLS、PF/WFP、账户隔离、Service 权限或发布信任；不通过强删账本、扩大超时、吞异常或改测试期望刷绿。
- 不把 emulator loopback 替身、native 单测、签名候选、真实手机/网络当成同一层验证。

## 下一阶段验收顺序

1. 首批三项非 UI 修复及后续 macOS 孤儿会话、两项依赖更新已核对精确交付门禁并合入 main。
   #1724 UI 仍待人工视觉验收；原夹具失败未被算作缺陷复现，macOS 末轮 minor 仍 open。
2. Windows WMI #1733 已完成源码/运行/审查，等待 Win10/11 安装机专项；Android handoff 与首连传播 WIP 等既有云端额度恢复验证。
   Windows resume 回执会涉及 #1643 的 Service handler 所有权路径，应先协调；macOS wake 门还缺同机时序证据，并与 #1504 的 helper/App 生命周期路径重叠。
   Android 后台通知/首连传播/诊断身份及其他列明项仍未完成，不因前述合入而划掉。
3. 通用 Android 按 API29/30（旧 requestNetwork）、31/32（新 callback）、33（通知权限）、34（FGS）、35/36（target 行为）
   分层验证；**本轮权限回归只覆盖 29/30/34**。云端之外至少补一台普通 Android 真机的 Wi-Fi/蜂窝、Doze、重启、always-on/lockdown。
4. macOS 在可恢复的实际安装设备验证 AI Home/Stable/Three-tier、睡眠/唤醒、退出/重开、恢复网络、升级/卸载；
   Windows 10/11 分别验证普通/管理员用户、网卡变化、WMI 延迟、Core/Service 被杀与升级中断。
5. 每项保存源 SHA、OS/架构、包哈希/签名、原始日志、预期与实测；UI PR 等人工视觉确认。
   全部按原发布门交付，不以“多模型都说通过”代替主线程验收。

原始模型报告、命令回执和云端附件保留于审计执行机 `/tmp/tono-product-audit-20261023/` 及 Devin 会话；
这里保留可长期理解的结论、来源、反例和验收要求，不将本机临时路径当作公共发布证据。
