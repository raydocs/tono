# Tono Android PR #1673：第 6 轮独立盲审

**结论：86/100，不通过。** 总分达到 85，但 D7 为 3/5，未达到单项 70%（3.5/5）；另有一项我判定触发原 rubric「严重状态误导」否决的源码问题：VPN 引擎进程断开后，首页仍可沿用旧的 Connected 快照。该判断来自源码路径，**未动态复现，未证实网络泄漏**。正常路径的截图、动效和本地 TUN 集成有可核查证据，但不足以给到 95，也不足以消除这条异常路径。

## 1. 身份、范围与盲审披露

- 实际评审模型：**GPT-6.1 Sol，模式 `gpt61s`**。本线程亲自完成；未调用子线程、子代理、Oracle、另一评审或实施线程。
- 仓库：`raydocs/tono`；PR：[#1673](https://github.com/raydocs/tono/pull/1673)；指定分支：`feat/android-singbox-horizon`。
- 唯一审查 head：[`bf449391feacb3fdc329680ca7115aea8397659a`](https://github.com/raydocs/tono/commit/bf449391feacb3fdc329680ca7115aea8397659a)。本地 detached HEAD 精确一致，未转向后续 head。
- CI：[39138009249](https://github.com/raydocs/tono/actions/runs/39138009249)，最终 `success`，`run_attempt=2`。
- 只定向提取该 head 的 `docs/agent-reports/2026-10-18-mobile-opus-5-5.md` 中 `## Rubric（原样，不改标准）` 至下一 H2 之前的内容，没有读取该文其他部分、其他 agent-reports、实施笔记、PR 正文或评论中的旧评分，也未索取或读取密封自评。
- **历史分数暴露披露：允许读取的 Rubric 段落本身含有「iOS 自评 91/100」字样，因此我看到了这一数字。未看到旧 Android 自评分，包括所述较早 head 的公开分数；未用 iOS 数字校准本次评分。**
- 这是只读审查：没有修改产品代码、提交、push、发布 GitHub 评论、合并、部署或发布。报告和证据保存在本地；结论仅回报请求盲审的 Puck，不发送实施线程。

## 2. 原 Rubric：原样提取

下面这一节保持原文，不增加验收标准。

## Rubric（原样，不改标准）

来源：两个实施线程转述的用户原始要求（iOS 线程原文：“统一100分：信息层级减字20、交互连贯单手20、高级克制及最新桌面品牌一致15、Liquid Glass材质15、状态动效15、可访问性适配10、真实性性能5；>=85且各项>=70%，严重状态误导/主操作难发现/不可读一票否决。”Android 线程同维度同权重，目标 ≥95，门槛 85，单项 70%）。PR 正文和分支记录里没有 rubric 全文，只有 iOS 自评“91/100”。

| # | 维度 | 满分 | 70% 线 |
|---|---|---|---|
| D1 | 信息层级 / 减字 | 20 | 14 |
| D2 | 交互连贯 / 单手 | 20 | 14 |
| D3 | 高级克制 + 与最新桌面品牌一致 | 15 | 10.5 |
| D4 | Liquid Glass / 玻璃材质 | 15 | 10.5 |
| D5 | 状态动效 | 15 | 10.5 |
| D6 | 可访问性 / 适配 | 10 | 7 |
| D7 | 真实性 / 性能（工程） | 5 | 3.5 |

通过条件：总分 ≥85 **且**每项 ≥70%；一票否决：严重状态误导、主操作难发现、不可读。

## 3. 逐维评分与门槛

| 维度 | 得分 | 比例 | 单项门槛 | 独立判断 |
|---|---:|---:|---|---|
| D1 信息层级 / 减字 | 18/20 | 90% | 通过 | 状态、短原因、主操作、线路、详情的层级清楚；Home 故障和保护建议的措辞比测量依据更肯定，扣分。 |
| D2 交互连贯 / 单手 | 18/20 | 90% | 通过 | 主操作和线路位于下部，Settings/Details 有可点击入口，也支持上滑；普通操作链与首页键盘动作有证据。真实旋转、OTP+IME、异常重绑的连续性仍未得到端到端验收。 |
| D3 高级克制 / 最新桌面品牌 | 13/15 | 86.7% | 通过 | 暖杏橙、墨色、日月海平线与当前桌面方向一致；不是用旧紫色规范强行评分。水面倒影仍偏规则横线/扇形，细腻度不及其余界面。未做桌面实机同步渲染对照。 |
| D4 Liquid Glass / 材质 | 13/15 | 86.7% | 通过 | 主胶囊和线路确有背景模糊，不是只用透明黑色假冒；边缘高光和压暗保证文字可读。观感仍偏厚重烟色描边胶囊，材质层次有提升空间；不把次级 sheet 不透明本身判为错误。 |
| D5 状态动效 | 13/15 | 86.7% | 通过 | 连接过程的日出、填充、到达后收敛和失败余烬有叙事，所查帧没有明显叠字；若干换态中标题及按钮字短暂接近空白，断开时太阳收落偏快。设计时钟序列不能证明设备流畅度。 |
| D6 可访问性 / 适配 | 8/10 | 80% | 通过 | 48dp、2.0 字号、小屏、中英文、首页可见焦点和横屏 fixture 均有证据；断言不覆盖所有窗口裁剪/离屏控件，TalkBack 真正朗读和真实 MainActivity 横屏键盘链未验收，中文展开状态仍硬编码英文。 |
| D7 真实性 / 性能 | 3/5 | 60% | **不通过** | APK、真实 Android 组件及 local-TUN/出口日志有可核查链路；引擎断开不撤销旧 Connected 是实质状态真实性缺陷。两次超预算和软件 GPU 性能数字也不支持性能已验收的结论。 |
| **合计** | **86/100** | **86%** | **不通过** | 总分线通过，但 D7 未过；且有下面的源码级否决判断。95 是目标，不是保底分。 |

**否决逐项：**

1. **严重状态误导：触发。** 我把下面 F1 的源码可达路径判为严重：引擎已失联，UI 却继续给出肯定的 Connected，而不是未知/核实中。未测得持续时长或发生率，不把它写成动态复现或泄漏事实。
2. 主操作难发现：本次检查的稳定可见状态未触发。过渡中的短暂淡出计入动效改进，不将其扩大为永久不可发现。
3. 不可读：本次检查的截图未触发。这个结论仅适用于看到的状态；不是对所有字体、IME、设备及父窗口裁剪的全称保证。

## 4. CI 的真实通过与失败记录

核对了 Actions run/jobs 元数据、两次 attempt 的原始日志、每条 instrumentation 输出及失败 artifact，而不是只看绿色总状态。

| 阶段 | 实际结果 | 关键事实 |
|---|---|---|
| attempt 1 build，job `117706395844` | success | 14:53:27–14:58:39 UTC；Gradle `BUILD SUCCESSFUL in 4m 49s`，构建、所选单测、lint 和 AndroidTest APK 构建成功。 |
| attempt 1 UI，job `117707505287` | **12/12 首次通过** | 14:58:41–15:08:16 UTC；包括 u9、l3；`Retry once on a fresh emulator` 为 skipped。 |
| attempt 1 system，job `117707505292` | **failure** | 14:58:41–16:22:34 UTC；包含两个内部 emulator 会话，均未完成全部用例。 |
| attempt 2 system，job `117726395167` | **13/13 + 出口日志核对通过** | 16:24:00–16:37:28 UTC；同 head，仅重跑 system，内部 retry skipped；build/UI 保留 attempt 1 时间，不是又跑一遍。 |

失败 artifact `12143211019` 的两个目录必须一起读：

- `evidence-attempt-1792337935/summary.txt`：a1 PASS；a2、a3 FAIL；`TIME-BUDGET ... 2186s before a4`。a2、a3 分别在宿主 `timeout 900` 后停止，instrumentation 未给出最终成功或产品断言失败堆栈，不能包装成「产品断言都通过，只差上传」。
- `evidence/summary.txt`：a1–a6、s1–s3、b1 PASS；`TIME-BUDGET ... 2566s before b2`。b2、b3、t1 在这一内部重试中未执行。
- 第一会话有 launcher ANR，两个会话均有 `com.android.vpndialogs/.ConfirmDialog` ANR / 输入派发超时；`foreign-anr.txt` 还记录 VpnDialogs 的 Wait 操作。保存的 emulator 退出记录为 status 0，不支持将这次失败称为已证实的 emulator 139 崩溃。
- 35 分钟是用例间检查的预算，单条 900 秒超时及清理可使实际停止时间超过 2100 秒，故 2186/2566 秒并不矛盾。
- 这些证据支持「托管模拟器极慢、系统组件 ANR、预算终止」；不支持由此断言产品必然无责，也不支持把所有失败归为产品逻辑错误。

**准确表述：同一 head 跨 attempt 1 的 UI 和 attempt 2 的 system 合计 25/25，并有额外 t1 出口分流日志核对。不是首次全过，也不是单个 attempt 新跑完 25 项。**

另查 JVM 报告 artifact `12140234423`：routing 16 tests / 0 failure / 0 skipped；mobile 41 tests / 0 failure / **17 skipped**，即 24 实际执行。跳过的是 opt-in 的 `MotionPreview` 2 项与 `ScreenshotRender` 15 项，源码以 `tono.screenshots` 门控。不能把这 17 项也说成已执行通过；它们与设备侧 25 项不是同一计数。lint 任务成功不等于零提示，SARIF 有 24 条结果。

## 5. 横屏、键盘与无障碍：实际证明到哪里

**横屏布局有有效证据，但不是真实 Activity 横屏验收。**

- `fixture-27-landscape-home.png`、`fixture-27-landscape-details.png` 是实际 2400×1080 横向图；`landscape-report.txt` 记录系统旋转成功、窗口 **866×363dp / 420dpi**，本次未走强制 orientation fallback。
- Home 中状态、主胶囊、线路与底部详情入口仍在窗口内，左侧限宽控制列没有粗暴拉满全屏。Details 下半部流量去向不在单张截图内，源码有滚动容器；不能仅凭这张截图指控内容永久裁掉，也不能因此声称每个离屏项都已操作验收。
- `ScreenSizeDeviceTest.kt:66–108, 162–179`：l3 启动的是 **ComponentActivity**；旋转后注入 fixture `TonoRoot` 与 no-op actions。它不经过真实 MainActivity 的引擎绑定、账号、系统授权恢复，也没有验证运行中真实界面旋转后的状态恢复。
- `A11yContract.kt:50–65` 检查文字自身布局的 ellipsis、maxLines、height overflow；没有检查 width overflow 或所有父容器/窗口裁剪。`:34–42` 对部分离屏节点跳过 touch bounds 检查；l3 明确逐个滚入并检查的是 Home 的 primary/exit/settings/details。不能将报告中的「no text cut off」扩写为全应用、所有控件的强保证。
- 登录 fixture 检查空邮箱阶段，没有横屏 OTP 阶段加系统软键盘截图。`SignInScreen.kt:120–140` 的 imePadding、横屏双栏和各自滚动方向合理，但这是源码支持，不是已完成的真实 IME 动态验收。

**键盘焦点不是空泛语义承诺，但覆盖面有限。**

- `fixture-25-keyboard-focus.png` 可见焦点轮廓。`keyboard-report.txt` 记录 Tab 依次 primary→exit→settings→details，轮廓像素变化分别 72%/74%/33%/50%；Shift+Tab×3、Enter 触发 disconnect；四个首页控件的 ACTION_CLICK 也有实际结果。
- 上述是 fixture 首页动作，不是登录输入、OTP、所有 sheet、系统 consent 的完整键盘闭环。
- `screen-reader-order.txt` 有品牌、降级状态、断开及持续时间、线路、速度、Settings、Details 的顺序；但 u6 检查的是可访问性树遍历。设备没有安装 TalkBack，不构成实际朗读、手势探索和焦点恢复验收。
- `fixture-13/14/15-font-2.0-*`、`fixture-26-small-phone-*`、`fixture-21` 至 `24` 的中文图没有看到稳定态主操作被挤掉或明显不可读。`SettingsScreen.kt:163` 的 expanded/collapsed 仍为英文硬编码，属于中文辅助技术体验的小缺口。

## 6. 玻璃、动效和措辞的独立判断

**玻璃确实采样并模糊后景。** `fixture-16-glass-blur.png` 与 `glass-report.txt` 对照了原条纹、Tono glass、相同 tint 无 blur、平台 blur：亮度条纹幅度为 162.5 / 0.1 / 83.2 / 0.4，报告中的条纹残留约 0.2% / 0.3%。这比仅看一张深色胶囊更能排除「只有透明遮罩」的实现。API 34 上成立；不是其他 API、真机 GPU 或极端背景的全面证明。

**动效分两类证据，不能混称两份原始录屏。** 下载的指定 UI/system artifacts 中只有一个原始 MP4：`fixture-motion.mp4`，20.9918 秒、1080×2400、可变帧率。UI artifact 另有 **392 张 JPG 和 16ms 设计时钟记录**；我按 62.5fps 拼成 `motion-from-ui-16ms-frames.mp4`，6.272 秒、540×1200，作为第二份检查视频。它是本次派生文件，不是第二个原始录屏，更不是实机稳定 60fps 的证据。

- 原始录屏约 00:03–00:05 未连接、00:07–00:08 连接中、00:09–00:11 已连接、00:12 断开中、00:13–00:15 未连接、00:17–00:19 失败；能看到日出/余烬和按钮状态收敛，但受模拟器墙钟与录屏采样影响，不用它精确推断动画毫秒数。
- 设计序列的 frame 25 / 00:00.400 为 PREPARING，frame 62 / 00:00.992 为 CONNECTING，frame 112 / 00:01.792 为 CONNECTED，frame 224 / 00:03.584 为 DISCONNECTING，frame 317 / 00:05.072 为 FAILED。
- **frame 32 / 00:00.512、120 / 00:01.920、232 / 00:03.712** 附近标题/主操作文字短暂接近空白；没有将两套标签叠在一起。`HomeScreen.kt:186–189` 的 90ms fade-out 与延迟 100ms 的 180ms fade-in 解释了这一淡出再淡入窗口。建议保持主动作字可辨，或缩短低可见区，而非恢复叠字。
- 失败态没有伪装成绿色受保护；水面规则横线和断开时太阳较快回落是视觉精修项，不是安全缺陷。
- `real-motion.txt` 的真实 App 场景像素变化为正常 0.3942%→禁用动画 0.0000%→恢复 0.4399%，支持系统 Remove animations 确有作用；并不等于已测完所有转场或达到帧率指标。

**措辞应区分测量、规则与全局状态。** `fixture-04-degraded.png`、`fixture-22-zh-degraded.png`、`fixture-27-landscape-details.png` 中的「AI paused / AI 已暂停」「Other apps still work」比单个 Home 探针失败更肯定。`Probes.kt:18–38` 以一次端点请求的异常/HTTP 回答判定路径；`TonoVpnService.kt:380–400` 更新显示状态，没有随之安装全局 AI 暂停规则。现有路由的匹配失败不回退 DIRECT，与「所有 AI 已暂停、所有其他应用正常」不是同一事实。建议改为「Home 检测失败；匹配 Home 的流量不会回退直连」，并保留重测入口。

## 7. 需要优先处理的具体问题

### F1 — 高优先级：引擎失联后沿用 Connected；源码级否决依据

**证据：** `ui/EngineClient.kt:41–44` 的 `onServiceDisconnected` 仅将 `engine=null`，不清除/降级 `_snapshot`；`:56–62` 的 unbind 同样保留快照。`ui/MainActivity.kt:37–42, 54–61` 直接收集该快照；`TonoRoot.kt:53–85`、`HomeScreen.kt:87–105, 158–207` 据其 phase 渲染 Connected、日间场景、Disconnect 和连接信息。失联期间 `command` 的空引擎调用被安静跳过（`EngineClient.kt:64–66`）。

**源码推论：** 若 `:vpn` 在 UI 仍存活时死亡，ServiceConnection 得到断开通知后，旧 Connected 不会立即撤销；需等待后续重绑与新快照，期间 UI 不表达「引擎状态未知」，旧计时也可能继续。后台停绑再回前台也有旧快照窗口。系统 surface 已有 freshness/boot/VPN-present 的 UNKNOWN 防线（`surface/PublicStatus.kt:68–84`），但首页没有等价约束。

**边界：** 本轮没有在设备上杀死 `:vpn` 并录制，未测量错显持续时长/频率，未检查该窗口的数据包，不声称已观察到保护释放、明文流量或路由泄漏。否决是针对源码允许在无法保证引擎存活时继续显示肯定 Connected 的产品状态判断。

**建议：** 绑定失联/重绑期间显式显示 Unknown/Checking，并使普通操作反映不可用；收到当前连接的新快照后才恢复肯定态。不要只清空成无解释的海景。补一个保持真实 MainActivity 前台、终止 `:vpn`、观察失联和重绑的回归，同时覆盖后台返回。

### F2 — 中优先级：保护建议和探针文案需要精确

- `strings.xml:111–114` / `fixture-11-settings.png` 提醒停止后可能直连，却仅建议 Always-on。Always-on 的重启意图不等于「block connections without VPN」；应明确严格阻断需要后者，分别显示这两个设置状态，不暗示只开 Always-on 就消除直连窗口。
- Home 探针措辞按上一节收窄。`TonoVpnService.kt:453–459` 对底层网络变化但 IPv6 布尔值不变直接返回；本轮所查的探测入口为连接启动、重载和手动 recheck，不能把旧 OK 当持续在线监测。建议标明最近检测时间/过期状态，并在相关网络变化后重测。
- 以上是源码及文案判断；未动态复现真实 Home 故障、蜂窝切换或保护缺口，不把它们写成已发生泄漏。

### F3 — 中优先级：补真实 MainActivity 的横屏、OTP+IME 和焦点链

保留现有 l3 布局回归，同时补真实 Activity 在已连接、登录验证码输入、系统软键盘开启时旋转的路径；检查主操作可滚入、输入内容/焦点保存、关闭 sheet 后焦点返回。对 Details/Settings 的离屏可操作项逐个滚入并执行，不只检查它们自己的尺寸。实际 TalkBack 朗读和中文展开状态也需要检查。这里是证据缺口，不是已证明布局故障。

### F4 — 中优先级：模拟器稳定性与性能证据分开报告

保留两次失败证据，不以 attempt 2 成功抹去 attempt 1；下一次有界复验时分别记录系统 VPN 对话框等待、单用例时长、主进程 ANR 与宿主负载。不要只继续增加全套重试次数。

`perf.txt` 五次冷启动为 1545/1349/946/1282/1244ms；其 gfxinfo 为 **72/72 janky，P50 300ms、P95 450ms**。这些数字来自软件 GPU 模拟器，不能据此断言真机同样卡顿，也不能称性能已过关。本地 TUN 连接时 PSS 为 App 80MB、引擎 77MB；需要真机测帧耗时、功耗和热状态后才谈移动端性能验收。

### F5 — 低优先级：视觉收尾

优先修正主动作淡出窗口，再微调水面反射的规则线条感、断开时太阳收落节奏与胶囊边缘高光。不要为追求玻璃感牺牲字的对比，也不需要把所有 Settings/Details 面板变透明。

## 8. local-TUN 与真实服务：已证明和未证明

**已证明：** t1 不是纯 UI fixture。它使用真实 MainActivity、VpnService、当前 ABI 的 libbox 和 TUN；经 adb reverse 访问 runner-local 控制面替身，走邮箱/固定验证码、目录、连接、断开、退出登录，截图有 LOCAL TEST SERVER 标识。`local-tunnel.txt` 记录连接约 11291ms，包含 consent 操作和模拟器耗时。

已直接交叉核对 `local-tunnel-requests.txt`、`local-tunnel-routing.txt`、`local-tunnel/exits.log` 和校验器：Cloudflare 探针及 YouTube 走 cloud；claude.ai 探针、api.anthropic.com 走 Home；cloud 日志出现连向 Home 地址 `198.20.0.11:21080` 的链路；direct example.com HTTP 200 在两侧出口日志均未出现。API Anthropic 的 404、YouTube 的 302 是连通路径回答，不是这些服务功能成功的证明。

**未证明：** 生产 Tono 账号、真实邮件投递、生产目录/策略发行、真实 Tono 出口与 Home 线路、所有域名/协议/应用、真实手机网络切换或全流量无泄漏。两个出口是 runner 本地替身；公开 HTTPS 请求通过它们发出，不把这一层偷换成生产服务验收。direct 成功且出口日志无记录是此请求的有界分流证据，不是全设备抓包证明。

`LocalTestServer.kt` 限定 debug、本地私有配置、显式端口的 `http://127.0.0.1:<port>/api/v1/`；账号恢复与 server 绑定。没有因看到这条调试通路，就把它称为生产 TLS 绕过或凭据泄漏。

## 9. 证据库存与复核方式

- UI artifact **12141320388**：18 张 PNG、392 张 JPG 帧及 UI 断言/报告。
- system 成功 artifact **12143093299**：30 张 PNG（real 14 / fixture 11 / local 5）、1 个原始 MP4 及 system/local-TUN 报告。
- 合计成功截图 **48 PNG = real 14 + fixture 29 + local 5**。real 前缀指真实 App/Android 组件在模拟器中运行，不指物理真机；fixture 不是实际在线状态；local 是替身服务上的真实 App/TUN 集成。
- system 失败 artifact **12143211019**：两个内部会话的 summary、未完成 instrumentation、logcat、ANR 与宿主证据；不计入上述 48 张成功截图。
- APK artifact **12140558090**：`tono-mobile-0.3.1-test-bf449391f.apk`，65,049,303 bytes；独立 SHA-256 为 `79ccae83fffc641d1568d8c5573c541d85ae1bdb88c6a9996736eced753bd333`，与 sidecar 及源码 head 记录一致。
- JVM/lint artifact **12140234423**：原始 HTML/SARIF 报告，含上述 17 项 skipped。
- 本轮检查包括 48 张 PNG 联系表与重点原图、两个视频观看材料及关键帧、run/jobs/失败日志、相关 UI/engine/routing/test 源码。没有在 orb 重跑 Android 模拟器、生产请求或真机测试，也没有重新触发 CI。
- 数量、checksum 和日志成功只证明其各自边界，不自动替代审美判断、故障复现或发布验收。

本地根目录：`/home/user/workspace/repo/.amp/in/artifacts/android-pr1673-r6-sol/`。

- 完整报告：`/home/user/workspace/repo/.amp/in/artifacts/android-pr1673-r6-sol/report.md`
- 完整证据清单（48 PNG 名称、视频来源、报告和源码定位）：`/home/user/workspace/repo/.amp/in/artifacts/android-pr1673-r6-sol/evidence-list.md`
- 证据 SHA-256 清单：`/home/user/workspace/repo/.amp/in/artifacts/android-pr1673-r6-sol/evidence-sha256.txt`
- 原样 Rubric：`/home/user/workspace/repo/.amp/in/artifacts/android-pr1673-r6-sol/rubric-verbatim.md`

**交付状态：仅本地盲审成果；没有 GitHub 发布，没有代码修复、合并或发布。当前 head 的结论为不通过；应先解决 F1，再用明确区分真实 Activity、fixture、local-TUN 和物理真机的证据复核。**
