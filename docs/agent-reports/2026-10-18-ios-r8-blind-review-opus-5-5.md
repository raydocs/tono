# Tono iOS 第 8 轮独立盲审 — raydocs/tono#1672

- 审查人模型：Claude Opus 5.5（`claude-opus-5-5`），Amp 线程 https://ampcode.com/threads/T-01a14f54-a1f6-77d2-85d7-bc1e832e223d
- 固定代码 head：`217eb1e434cdbf92a7eb2312959d3e0cfdabc1e4`（日志 tip `f7b7ddd50f176951932513ca5ec257b8ac6580ae` 只比 217eb1e 多改了 `docs/changelog.d/2026-10-17-ios-singbox-horizon.md`，增加 7 行；已用 `git diff --stat` 核实）
- CI：iOS CI run `39130734441`，headSha = 217eb1e，conclusion = success，2/2 job 成功
- UI 测试：`ui-tests.log` 中 21 个测试执行、0 失败，日志里没有 "skip"（`grep -ci skip` = 0）；`REAL-WIDGET gallery-lists-tono=yes gallery-text-exposed=no placed-and-read=yes`
- Artifact：`12139096378`（ios-preview-screenshots，653 MB；本地 zip 的 sha256 前缀 `c7fc7b213f76ea17`），共 64 张 PNG、5 个 MP4，模拟器是 iPhone 17 Pro，Xcode 26.6
- 隔离：rubric 只读了 PR 正文的 "Rubric (verbatim, unchanged)" 一节（正文第 76–84 行）。没读过往评审的分数和结论，没读 GPT 复审，也没问实施线程的自评分。PR 正文第 72 行在定位 rubric 时被 grep 带出来，里面有上一轮的自评分；本次评分没有参考这个数字。
- 范围：只做评审，不改代码、不发 GitHub、不通知实施线程、不合并发布。

## Rubric（原文，未改）

> 统一100分：信息层级减字20、交互连贯单手20、高级克制及最新桌面品牌一致15、Liquid Glass材质15、状态动效15、可访问性适配10、真实性性能5；>=85且各项>=70%，严重状态误导/主操作难发现/不可读一票否决。

## 结论

**83 / 100，未通过（低于 85）。** 没有触发否决项，七项都不低于 70%，但"真实性性能"正好卡在 70%。

| 维度 | 满分 | 得分 | 得分率 |
|---|---|---|---|
| 信息层级减字 | 20 | 17 | 85% |
| 交互连贯单手 | 20 | 16 | 80% |
| 高级克制及最新桌面品牌一致 | 15 | 13 | 87% |
| Liquid Glass 材质 | 15 | 12 | 80% |
| 状态动效 | 15 | 13 | 87% |
| 可访问性适配 | 10 | 8.5 | 85% |
| 真实性性能 | 5 | 3.5 | 70% |
| **合计** | 100 | **83** | — |

否决项逐条核对：
- 严重状态误导：没有。9 个 phase 的标题与状态行都和 fixture 一致。Reconnecting 时太阳停在 0.9 高度，接近 Connected，不过标题写的是"Reconnecting"，主按钮是 Cancel，所以只算动效扣分。
- 主操作难发现：没有。主胶囊在拇指区，每个状态各有一个主操作。
- 不可读：没有。最大字号、提高对比度、降低透明度三套截图都可读，Apple 的 accessibility audit 三个测试也都通过。

## 指定核查项

### Settings / Details 路由检查（route check）
- **Settings 已不含 route check**（代码）：`SettingsView.swift` 只剩注释 "Where does a site go?" lives in Details；`RouteCheck` 结构体仍定义在这个文件里，但只被 `DetailsSheet` 使用。截图 `en-08-settings.png` 和 `settings-scrolled-under-bar.png` 里看不到检查框。
- **Details 已含 route check**：放在"Where traffic goes"卡片底部（`DetailsSheet.swift` 的 lanes）。`en-09b-details-full.png` 显示 large detent 下整个 Details 一屏放得下，最底部是 Settings 行，和 217eb1e 的提交意图一致。`en-09-details.png` 是 medium detent，检查框和 Settings 行都在屏幕下方，要上拉才能看到。
- **Settings 两个入口都通**：`testSettingsReachableFromDetailsAndCloses` 通过，覆盖 Details → Settings 行、首页齿轮（断言其位于屏幕下 1/3）、关闭按钮。`sheet-zoom.mp4` 约 4–6 s 和 16–18 s 能看到 Settings 从齿轮放大展开。
- **缺陷 R8-1（证据：截图 + 视频 + 代码）：检查结果被键盘挡住。** `details-route-check.png` 是测试在断言答案"存在"之后才截的，但画面里键盘仍然弹着，检查框下面看不到任何 "TCP → … · UDP → …" 文本。`ui-tests.mp4` 约 500–508 s 是同一个测试：输入 claude.ai 并回车后键盘一直没收起，结果始终不可见。代码原因：`RouteCheck.run()` 没有释放焦点，结果 `Text` 渲染在输入框下方，ScrollView 也没有滚到它；测试只断言 `waitForExistence`，没断言 `isHittable`，所以 CI 是绿的。用户按 Search 后看不到任何反馈。这是 Details 里新功能的交互断点。

### 玻璃视觉
- 代码（`Theme.swift` GlassSurface）：iOS 26 上用真正的 `.glassEffect(.regular.tint(...).interactive())`，加上 sheen、rim，以及第 8 轮新增的 catchLight（径向椭圆，太阳在 x=0.5，月亮在 x=0.81）。打开 Reduce Transparency 或 Increase Contrast 时改为不透明填充加描边。Settings 用的是系统 NavigationStack，所以关闭按钮是系统玻璃，并带 scroll-edge 模糊（`settings-scrolled-under-bar.png` 里标题下面能看到被模糊的内容）。
- 截图：`en-04-connected.png` 的 Disconnect 和 Tokyo 两个胶囊顶部中央都有暖色光斑；`en-02-idle.png` 的 Tokyo 胶囊右侧有月光偏亮区，方向和天空一致，第 8 轮的改动可以看到。`a11y-increase-contrast-connected.png` 和 `a11y-reduce-transparency-connected.png` 都正确退化成不透明胶囊（两图像素差 AE = 1.6%，和玻璃版本差异明显）。
- 问题：
  - (a) 两个胶囊上的光斑位置、大小完全相同，上下叠在一起，看起来更像重复的装饰印章，不像同一束光打下的反射。在 Connecting 的暗轨道（`en-03a-preparing.png`）上，光斑看起来像一块浑浊的污渍。
  - (b) 胶囊后面基本是被 scrim 压暗的均匀海面，折射和透视几乎看不出来；玻璃感主要靠描边和光斑撑着。
  - (c) Details、Lines、Settings 三个 sheet 的内容卡都是 `contentCard` 烟色不透明卡片，首页的玻璃语言没有延续进去。
  - (d) 首页的 "Details ⌃" 是纯文字，旁边的齿轮却是玻璃圆钮，这一对控件的材质不一致。

## 逐维理由与建议

### 1. 信息层级减字 17/20
- 优点：首页只有状态标题、一行原因、主胶囊、线路胶囊、齿轮和 Details（`en-02/04/05/06/12/13/14`）。原因细节都放进了 Details 的 "What happened"。中英文长度控制得好（`zh-Hans-*`）。
- 扣分：
  - "Routing mode" 在 Details（`en-09b`，只有标题）和 Settings（`en-08`，带说明）里各有一份，同一个控件出现在两处。
  - Settings 的 iOS VPN Protection 卡片里有开关、推荐语、"How this works"，还有一段橙色警示，信息偏密。
  - route check 的答案是 "TCP → Home · UDP → Cloud" 这种协议术语。
  - Lines 里的 "Dawn" / "Grove" 副标题没有解释（`en-07-lines.png`）。
- 建议（按优先级）：
  1. 路由模式只保留在 Details 一处，Settings 那里改成链接过去或者直接删掉。
  2. route check 的答案改成用户语言，比如"claude.ai 走家宽"，TCP/UDP 的细分放到二级。

### 2. 交互连贯单手 16/20
- 优点：所有入口都在下半屏，sheet 下滑可回首页（`testEverySheetClosesWithASwipeBackToHome`），sheet 从触发控件放大展开（`sheet-zoom.mp4`）；启动中途被 sheet 打断或切到别的 App，回来仍会到达已连接（`interrupted-start-arrives-connected.png`）；云出口失败时"Other line"直接打开 Lines（`other-line-opens-lines.png`）。
- 扣分：
  - R8-1：检查结果被键盘挡住（见上节）。
  - Details 默认是 medium detent，新加的检查框和 Settings 行都在折叠线以下（`en-09-details.png`）。
  - 离线时首页仍是可按的橙色 Connect（`en-14-offline.png`），文案写的是"No network connection right now."，用户会怀疑按了有没有用。
  - Settings 的关闭 X 在右上角，不过下滑也能关，所以只是小问题。
- 建议：
  1. `run()` 之后释放焦点（`@FocusState` 置 false），并用 `ScrollViewReader` 把结果滚进可视区；或者把结果放到输入框上方或同一行。测试改成断言 `answer.isHittable`。
  2. 离线时把主按钮降级或改成说明，或者说清楚"联网后自动连接"。

### 3. 高级克制及最新桌面品牌一致 13/15
- 优点：海、日、月的叙事贯穿 Sign-in、Onboarding、首页、widget、Live Activity，暖橙主色只给主操作，排版克制。中文排版没有挤压（`zh-Hans-04/08`）。
- 扣分：
  - 这次没拿到本轮最新的桌面截图做逐像素对照，品牌一致只能凭代码注释（"direction B, shared with Android and the desktop"）和整体语言判断，不计满分。
  - catchLight 光斑偏重。
  - 系统浅色外观下 App 仍是深色（`en-18-system-light-appearance.png`）。作为品牌选择可以接受，但没说明理由。
- 建议：附一张同状态的桌面和 iOS 对照图，作为品牌一致的证据。

### 4. Liquid Glass 材质 12/15
- 理由见上面"玻璃视觉"：(a)–(d)。没有 GlassEffectContainer，代码注释说是为了对比度（run 39097318071）而有意不用，可以理解，但相邻胶囊之间也就没有融合或形变。
- 建议：
  1. 两个胶囊的 catchLight 改成一个跨控件的连续光柱，比如按控件的全局 y 坐标衰减，而不是每个胶囊各放一个椭圆。
  2. 至少让 Details 和 Lines 的头部或分组用轻玻璃，和首页呼应。
  3. 只在模拟器上验证过，真机上的 glass 渲染和性能还要看。

### 5. 状态动效 13/15
- 优点：`state-cycle-en.mp4` 0–30 s 覆盖 Connecting(1–3 s) → Connected(4–7 s) → Partly working(8–10 s) → Connected → Reconnecting(14–16 s，带扫描线) → Disconnecting(19 s) → Not connected(20–22 s) → Connecting → Didn't connect(24–27 s)。太阳和月亮的高度、天色、倒影随状态变化；Cancel 胶囊里的进度填充能说明进度；计时器连续走。`state-cycle-reduce-motion.mp4` 里变化是分级跳变，不是连续运动，文字只有约 0.1–0.2 s 的交叉淡化（24.5–27 s 逐帧核过）。
- 扣分：
  - Reconnecting 的太阳高度 0.9，Partly working 只有 0.72（`ConnectionState.swift` SkyState.sunRise），隧道还没恢复的状态反而比"隧道已通但部分失败"更亮。`en-12-network-changed.png` 和 `en-04-connected.png` 的天空几乎一样。
  - 触觉反馈（`StateFeedback`）在模拟器上没法验证。
- 建议：Reconnecting 的太阳降到不高于 degraded，或者叠加明显的"等待"特征，比如倒影断续、光晕变暗。

### 6. 可访问性适配 8.5/10
- 优点：
  - `testAccessibilityAuditHomeStates`、`testAccessibilityAuditLargestText`、`testAccessibilityAuditSheets` 都通过。
  - 最大字号下首页、Details、Settings、Onboarding、Primer、Widgets 都改为纵向重排（`a11y-largest-text-en-*`）。
  - Reduce Transparency、Increase Contrast、Reduce Motion 三条代码路径都在。
  - 有 magic tap；关闭按钮有 accessibilityLabel "Close settings"。
- 扣分：
  - route check 结果只加了 `.updatesFrequently` trait，没有 announcement，VoiceOver 用户提交后听不到答案。结果又在键盘下面（R8-1），所以这一点比较重。
  - 代码注释自己承认 VoiceOver 阅读顺序"needs a VoiceOver pass on a device"，CI 没有覆盖。
  - 最大字号的 Onboarding 截图里看不到 Continue（`a11y-largest-text-en-onboarding.png`）。代码里有 `BottomScroll`，audit 也通过了，但静态截图没有展示滚动后的样子。
- 建议：结果出来后发 `AccessibilityNotification.Announcement`。

### 7. 真实性性能 3.5/5
- 优点：每张截图都有黄色 "Preview · fixtures · no account/tunnel" 标签，README 写明不能拿这些截图证明登录、联网或路由；真实 widget 已经放进系统 gallery 和主屏并读到内容（placed-and-read=yes）；Live Activity 是真实 ActivityKit 跑在 Dynamic Island 里（`live-activity-island-*.png`）。
- 扣分（按要求不计满）：
  - 没有真机、签名构建、真实隧道、联网验证。
  - `perf.txt` 是宿主机上模拟器进程的数据，常驻动画时 CPU 约 7–8%，Reduce Motion 下 0.2–0.7%，RSS 约 210 MB，不能代表 iPhone 功耗。
  - 主屏真实 widget 显示 "Status unavailable"（`real-widget-home-screen.png`），只证明了放置和读取链路，没有证明真实状态的同步。
- 建议：真机跑一轮，确认空闲时常驻 TimelineView 动画的能耗，以及 widget 显示的是真实状态。

## Code-only 发现（截图和视频里看不到，只从源码得出）
1. `UITests.swift` 的 `testRouteCheckInDetailsAnswers` 只断言 `waitForExistence`，元素被键盘挡住时仍判通过，所以 R8-1 能通过 CI。
2. `RouteCheck` 的结果只加了 `.updatesFrequently`，没有 VoiceOver announcement。
3. `SkyState.sunRise` 里 reconnecting = 0.9，duskWarning = 0.72，亮度排序和状态的健康程度相反。
4. `openSettingsFromDetails` 写死了 450 ms 延时再打开 Settings。如果关闭 Details 的动画更慢，或者系统开了 Reduce Motion，可能出现 sheet 竞态。目前测试通过，算低风险。
5. Settings 和 Details 各自实现了一套 ModeRow（两份代码），这是路由模式出现在两处的源头。

## 证据清单（artifact 12139096378，sha256 前 16 位）
| 文件 | sha256 | 用途 |
|---|---|---|
| en-04-connected.png | 406b9aedf0553745 | 首页层级、catchLight |
| en-08-settings.png | a461c74aaf59a51e | Settings 无 route check；路由模式重复 |
| settings-scrolled-under-bar.png | 7900448c69a03f80 | 系统玻璃导航栏、scroll edge |
| en-09-details.png | 586cfdfc995d16c3 | medium detent 下 route check 在折叠线以下 |
| en-09b-details-full.png | f70920c5fe274501 | Details 一屏放得下 |
| details-route-check.png | 5bd427d073963390 | R8-1：答案被键盘遮挡 |
| en-12-network-changed.png | 388c55a892ba89e0 | Reconnecting 太阳过高 |
| en-05-degraded.png | fc0539f25d191733 | degraded 太阳较低 |
| a11y-increase-contrast-connected.png | e5a9fe66ae1e96f5 | 不透明退化 |
| a11y-reduce-transparency-connected.png | a953ff0264b5fcdd | 不透明退化 |
| a11y-largest-text-en-connected.png | 66242a1964de59e8 | 最大字号重排 |
| a11y-largest-text-en-onboarding.png | aaf147ef67932f01 | Continue 不在首屏 |
| real-widget-home-screen.png | 5c36ba95dab77aef | 真实 widget 显示 Status unavailable |
| ui-tests.mp4 | 6e753c1a9822013f | 约 500–508 s：route check 键盘不收起 |
| sheet-zoom.mp4 | 92b46b1b4a57872f | 约 4–6 s 和 16–18 s：齿轮放大展开 Settings；约 0–2 s：Details |
| state-cycle-en.mp4 | b6c06b3a2cd3d2b3 | 0–30 s 状态循环 |
| state-cycle-reduce-motion.mp4 | c6e3ebdd7b22bd9c | 24.5–27 s 交叉淡化逐帧 |

代码（都在 217eb1e）：`apps/ios/App/Views/{DetailsSheet,SettingsView,HomeView,Theme,Components}.swift`、`apps/ios/TonoKit/Sources/TonoKit/ConnectionState.swift`、`apps/ios/UITests/TonoUITests.swift`。

视频时间点的对齐方法：`ui-tests.mp4` 的时间 ≈ 测试套件开始后的偏移 + 约 38 s，用 permission 测试和 Live Activity 测试的画面校准过；这是估算值，误差约 ±2 s。
