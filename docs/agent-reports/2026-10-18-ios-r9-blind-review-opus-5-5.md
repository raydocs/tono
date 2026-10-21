# raydocs/tono PR #1672 iOS 第 9 轮独立盲审（Opus 5.5）

- 审查对象：固定代码 head `b36d07d7907f39364f1cfe4309d60824fea9d24e`。分支 tip `8dd22e21dab25f73530b5b2fe4947e2a98ede885` 相对 b36d07d 只改了 `docs/changelog.d/2026-10-17-ios-singbox-horizon.md`（+15 行，已用 `git diff --stat` 核对），所以没有采用 tip 之后的任何 head。
- CI：iOS CI run `39140462842`，push 触发，headSha=b36d07d，conclusion=success；2 个 job 均为 success（Linux 的 TonoKit/sing-box 路由检查，以及 macOS 的 Libbox/Xcode/模拟器预览）。
- Artifact `12142836958`：65 PNG、5 MP4、README/device/install/launches/perf txt、ui-tests.log、Libbox.provenance.json，共 77 个文件，sha256 见 `pr1672-r9-evidence/artifact-sha256.txt`。README 写明 `Commit: b36d07d… Run: 39140462842`；设备为 iPhone 17 Pro 模拟器，每张截图都对应一次独立启动（launches.txt 列出了 pid）。
- ui-tests.log：`Executed 22 tests, with 0 failures`，22 个用例全部 passed，日志中没有 skip。日志第 2804 行为 `REAL-WIDGET gallery-lists-tono=yes gallery-text-exposed=no placed-and-read=yes`。
- 审查人与模型：Claude Opus 5.5（`claude-opus-5-5`），在本 Amp 线程中亲自完成，没有创建子线程或子代理。
- 资料边界：rubric 只取自 PR 正文 `## Rubric (verbatim, unchanged)` 一节，用 awk 定位提取，正文其他部分没有读。没有读 `docs/agent-reports/` 下的任何文件，也没有读其他盲审线程或实施方的自评分。
- 没有运行旧 head 的回归，因此本报告不包含任何 Red 结论。

## Rubric（原文）

> 统一100分：信息层级减字20、交互连贯单手20、高级克制及最新桌面品牌一致15、Liquid Glass材质15、状态动效15、可访问性适配10、真实性性能5；>=85且各项>=70%，严重状态误导/主操作难发现/不可读一票否决。

## 结论

| 维度 | 满分 | 得分 | 比例 |
|---|---|---|---|
| 信息层级减字 | 20 | 17 | 85% |
| 交互连贯单手 | 20 | 17 | 85% |
| 高级克制及最新桌面品牌一致 | 15 | 13 | 87% |
| Liquid Glass 材质 | 15 | 12 | 80% |
| 状态动效 | 15 | 13 | 87% |
| 可访问性适配 | 10 | 8 | 80% |
| 真实性性能 | 5 | 4 | 80% |
| **总分** | 100 | **84** | — |

**门槛判断：不通过。** 总分 84，比门槛 85 少 1 分；七项都在 70% 以上；三条一票否决都不触发。
离目标 95 还差 11 分。我没有为了过线调高任何一项。下文 P1 的三条修复属于能拿回分数的可修问题。

一票否决逐条判断：
- **严重状态误导：未发现。** 每个状态的标题、一行状态说明、主按钮、天空（日/月）四者一致。过渡帧中的混合态只在交叉淡化期间出现，Reduce Motion 下约 150 ms（见 V5），不构成误导。
- **主操作难发现：未发现。** 所有主页状态的主胶囊都在拇指区，带橙色渐变或描边（en-02…en-14）。AX5 下仍然是第一个控件。
- **不可读：未发现。** 中英文默认字号、AX5 和 zh 大字号都没有截断或重叠（a11y-largest-text-*、a11y-large-text-*）。

## 证据（固定 head 与 run；V = 我看过的视觉证据，S = 源码推论，D = 真机未验证）

### 视觉证据 V（artifact 文件名与时间码）
- **V1 状态主页**：en/zh-Hans 的 02 idle、03a preparing、03 connecting、04 connected、05 degraded、06 failed、12 network-changed、13 dropped、14 offline。天空映射为：月亮（未连接）→ 半日（连接中）→ 高日（已连接）→ 地平线日加月（失败/掉线）。每个状态的主按钮分别是 Connect、Cancel、Disconnect+计时器、Retry，语义正确。
- **V2 Details 查询，键盘与结果**：
  - `details-route-check.png`：键盘已收起，答案 "example.com goes directly over your own network. TCP → Direct · UDP → Direct" 和 "not a live test" 完整可见。
  - `ui-tests.mp4` 约 600.5–606.5 s（testRouteCheckAnswerIsVisibleAfterSubmit 于 16:10:59.6 开始，视频起点 16:01:09）：600.5 s 时 sheet 已为 large；602.5–603 s 键盘弹出，输入框位于键盘上方；603.5 s 键盘收起，答案出现在输入框下方；到 606.5 s 一直保持可见。
- **V3 切换模式后结果**：
  - `details-route-check-stable.png`：Stable 选中后，答案变为 "goes through the cloud exit. TCP → Cloud · UDP → Blocked"，"Other apps" lane 同步变为 Cloud · Japan。
  - `ui-tests.mp4` 约 586–589.5 s：586/587.5 s 为 Three-tier 下的 direct 答案；588.5 s 为 Stable 下的 cloud 答案，答案与模式行同屏。
- **V4 编辑域名后结果：没有视觉证据。** 没有截图或录像展示改域名之后答案被清除，只有源码证据（见 S2）。
- **V5 动效**：
  - `state-cycle-en.mp4` 每秒抽帧，见 `grid_state-cycle-en.jpg`。0→2 s Connecting 的进度填充扫动；约 3 s 到 Connected；7–9 s 为 Partly working；13–15 s 为 Reconnecting，太阳下沉；17–18 s Disconnecting；19 s 月出。
  - 过渡瑕疵：2.7 s 时计时器 "47:00" 与扫动填充的末端叠在一起；17.3 s 交叉淡化中，流量行数字叠成 "184/4 K"（`hi_grid.jpg`）。
  - `state-cycle-reduce-motion.mp4` 是 VFR 录像，我按真实帧 pts 抽帧（`rm5_grid.jpg`）。1.13→3.365 s 画面静止（进度条静态，不扫动）。3.365 s 出现半透明混合帧（"连接中" 加上 "取消 47:00"）；3.453 s 一帧无标题、按钮无文字；3.518 s 进入 "已连接"。整个交叉淡化约 150 ms。
  - `sheet-zoom.mp4`（`grid_sheet-zoom.jpg`）：Lines、Details、Settings 依次从各自控件缩放展开并收回。约 19 s 和 25 s 有控件与 sheet 互相 morph 的中间帧。
- **V6 玻璃**：
  - `cmp_a11y.jpg` 依次为 zh-Hans-04 默认、Increase Contrast、Reduce Transparency。默认状态下 Disconnect 胶囊能透出背后的暖色光柱，有高光描边；增强对比和减少透明度两种模式下变为不透明实底。
  - 三张 sheet（en-07、en-09、en-08）呈深灰实感，只在顶部边缘能看出一点玻璃。
- **V7 无障碍**：
  - a11y-largest-text-en 的 connected/details/settings/idle/onboarding/primer/widgets 共 7 张：标题和胶囊都重排，Tokyo 不再断词，"Details" 改为可滚动。`crop_lt_conn.jpg` 显示 Details 位于滚动区底部。
  - zh 大字号的 connected/details/signin 均正常。
  - 对应审计用例 testAccessibilityAuditHomeStates、Sheets、LargestText 全部 passed。日志中的 SWEEP 结果都是 "0 below 4.5:1 or under 44x44 pt"。
- **V8 真实与预览**：
  - 除 en-09b 和 details-route-check*（sheet 全高盖住了徽章）外，所有 app 截图都带黄色 "Preview · fixtures · no account/tunnel" 徽章。
  - `real-widget-gallery.png` 和 `real-widget-home-screen.png` 是系统真实的小组件库和主屏，但只展示了 "Status unavailable" 一种状态。
  - `live-activity-island-compact/expanded.png` 是系统真实的 Dynamic Island，内容为预览 fixture，展开态带 Preview 标签。
  - `real-widget-home-screen.png` 的灵动岛里还残留着上一个用例的预览 Live Activity（绿色日标加 "50:22"），紧凑态没有 Preview 标签，而同一张图里的小组件显示 "Status unavailable"，两者信号互相矛盾。
- **V9 其他**：
  - `settings-scrolled-under-bar.png`：滚到标题栏下方的内容被 scroll-edge 模糊，"Settings" 标题仍清晰，但下层的 "What Tono can…recognise" 隐约可见。
  - `en-17b-widgets-light-wallpaper.png`：白色状态栏压在浅色背景上几乎不可读。该页面是 DEBUG-only 的 WidgetGallery，不计入产品。

### 源码证据 S（b36d07d）
- **S1 Details 查询**（`apps/ios/App/Views/SettingsView.swift` 中的 RouteCheck，以及 `DetailsSheet.swift`）：
  - 提交时执行 `focused = false`；0.35 s 后 `scrollTo("routeAnswer", .bottom)`；0.4 s 后发出 VoiceOver `.announcement`，只朗读 TCP 结论。
  - 获得焦点时 sheet 的 detent 改为 `.large`。
  - `model.explain` 和隧道使用同一个 `SingBoxConfig.build`，所以答案来自真实规则，不是另写的解释层。
- **S2 改域名清除答案**：`onChange(of: host)` 中，当 `cleanHost(value) != answer.host` 时置 `answer = nil`；`onChange(of: model.mode)` 中如果已有答案就重新运行。没有 UI 测试覆盖“改域名即清除”这条路径。
- **S3 无效或空输入**：`run()` 在 `explain` 返回 nil 时只执行 `answer = nil`，界面上没有任何反馈。
- **S4 模式切换**：`setMode` 先改 `mode` 再调用 `pushInputs`。如果扩展拒绝 reload，会显示 CORE_START，但 UI 上的模式和查询答案仍是新模式，而扩展继续运行旧图（注释原文是 "keeps the previous graph running"）。这是边缘情况，未在模拟器复现。
- **S5 玻璃**：
  - `Theme.swift:187` 使用 `.glassEffect(.regular.tint(...).interactive())`；iOS 26 以下回退到 `.ultraThinMaterial`；Reduce Transparency 或 Increase Contrast 下改为实底。
  - Home 刻意不使用 `GlassEffectContainer`，注释给出的理由是它会把玻璃抬到标签上方，导致对比度问题。
  - `SheetSurface` 在系统 sheet 玻璃上叠加 `smoke.opacity(0.6)`。
- **S6 动效**：
  - SeaScene 用 30 fps 的 TimelineView，Reduce Motion 时暂停。
  - 进度填充时长为 0.9 s 加上 0.6 s 淡出。
  - 状态切换使用 `swap` 过渡；`zoomTransition` 在 Reduce Motion 时关闭。
- **S7 无障碍**：
  - 已实现 magic tap、语义排序（`accessibilitySortPriority`），设置齿轮有 `accessibilityLabel`，原因行有 hint。
  - HomeView 注释自认 "VoiceOver order … needs a VoiceOver pass on a device"。
  - 审计 helper 会用自写的像素测量（取第 97 百分位亮度对中位数）复核 Apple 的 contrast 标记，≥4.5:1 即放行；AX5 下的 textClipped 预测和小组件的 Dynamic Type 标记只记日志。
- **S8 真实小组件测试**：`testZZRealWidgetInTheSystemGallery` 只断言了 "Tono status" 出现在小组件库，`placed` 只 print 不断言。本 run 输出了 yes，但如果以后变成 no，测试仍会通过。
- **S9 预览隔离**：`isPreview` 被 `#if DEBUG` 包住，WidgetGallery 也只在 DEBUG 下编译，Release 不会显示 fixture 内容。
- **S10 品牌**：`apps/ios/tools/generate-ios-brand.py` 声明与桌面共用同一套日出海面绘制源，取自 Windows 的 `generate-tono-icons.py`（decision 095）；macOS 也有 `SeaSceneWater.swift`。我没有拿到桌面端截图做并排比对。

### 真机未验证 D
VoiceOver 实际朗读顺序和公告时机、触觉反馈、真实隧道下的状态转换与时长、真实 Live Activity（非 fixture）、Control Center 控件、用户放置的 Lock Screen 小组件、真实快照下的主屏小组件（connected/stale）、真机 GPU 上的 Liquid Glass 观感、30 fps 天空动画的耗电和发热。perf.txt 只是 Mac 主机上模拟器进程的 CPU/RSS（connected-live 4.7–6.2%，reduce-motion 0–0.4%，idle-live 6.1–7.3%）。XCTCPUMetric 中 instructions/cycles 为 0，等于不可用，不能代表 iPhone 性能。

## 各项评分理由

1. **信息层级减字 17/20**
   - 优点：主页只有标题、一行状态、主胶囊、线路胶囊和 Details/设置，字很少。Details 分四段：发生了什么、流量去向、路由模式、设置，层级清楚。
   - 扣分：
     - 模式名 "Three-tier / Stable"（三层路由 / 稳定）是内部术语，Details 里只有标题没有说明（en-09b、zh-Hans-09b）。用户只能从上方 lanes 的变化去反推含义。
     - 英文 "Protected · Home in United States" 与线路 "Tokyo" 并列，"Home" 容易被理解为首页或住址（zh 的 "家宽在美国" 更清楚）。
     - Lines 中的 "Dawn / Grove" 副标题来自目录名，中文界面不翻译也没有解释（受 fixture 影响，权重低）。
2. **交互连贯单手 17/20**
   - 优点：
     - 主操作、线路、Details 都在下半屏；sheet 可下滑关闭（testEverySheetClosesWithASwipeBackToHome 通过）。
     - 查询后键盘收起，答案可见，切换模式时答案随之更新（V2/V3，录像已证）。
     - 中断后启动仍能到达已连接（`interrupted-start-arrives-connected.png`）；"Other line" 能打开线路选择（`other-line-opens-lines.png`）。
   - 扣分：
     - 齿轮（设置）与 "Details ⌃" 只隔 2 pt 并排，看起来像一个控件 "⚙ Details"，第一眼容易把齿轮当成 Details 的图标（en-02/en-04）。
     - 空输入或无效输入点 Check 没有任何反馈（S3）。
     - 改域名清除答案只有源码证据（V4/S2）。
     - Details 以 medium 打开时，查询框在折叠线以下（zh-Hans-09-details），需要先上滑。
3. **高级克制及最新桌面品牌一致 13/15**
   - 优点：日出海面、单一暖橙强调色、细字大标题、沉稳的深色，与桌面共用一套品牌源（S10）。系统切到浅色外观时保持品牌深色（en-18）。
   - 扣分：没做桌面并排视觉核对；Settings 滚动边缘的模糊偏弱，能看到重影（V9）。
4. **Liquid Glass 材质 12/15**
   - 优点：使用原生 `glassEffect`，可交互，tint 跟随天空；控件可以 zoom morph 成 sheet；有 scroll-edge；减少透明度和增强对比度两种模式都已验证（V6）。
   - 扣分：
     - 三张 sheet 叠了 60% smoke，看起来基本是不透明的深灰卡，玻璃感主要只剩在主页的两个胶囊和齿轮上。
     - 没有 GlassEffectContainer 的融合与 morph（有意的取舍，理由成立，但材质分相应扣除）。
5. **状态动效 13/15**
   - 优点：天空和日月准确映射状态；进度扫动；Reconnecting 的扫描光（源码）；数字用 numericText；Reduce Motion 下画面静止且交叉淡化很短（V5）。
   - 扣分：
     - 过渡帧有叠字："47:00" 叠在填充末端（2.7 s），流量数字叠成 "184/4 K"（17.3 s）。
     - Reconnecting 的静态画面与 Partly working 的太阳高度几乎一样（en-12 对 en-05），静态截图难以区分。
     - 触觉反馈未验证。
6. **可访问性适配 8/10**
   - 优点：AX5 下 7 个画面都重排、可滚动、无截断；中文大字号正常；三类审计全部通过；有 VoiceOver 公告和 magic tap。
   - 扣分：
     - VoiceOver 顺序未在设备上走查（代码自认）。
     - contrast 结论依赖自写测量对 Apple 标记的复核（S7），测量方法偏宽松。
     - Increase Contrast 下次要文字（计时器、延迟）没有提亮（`cmp_a11y.jpg`）。
7. **真实性性能 4/5**
   - 优点：预览标注一致，README 明确声明不能作为连接或路由的证据；真实小组件已放上主屏并被读取；真实 Dynamic Island 已展示。
   - 扣分：
     - 真实小组件只证明了 "unavailable" 一种状态，且 `placed` 没有断言（S8）。
     - 残留的预览 Live Activity 污染了 `real-widget-home-screen.png`（V8）。
     - 性能数据只有主机侧，没有 iPhone 数据。

## 按优先级的具体建议（不实现，只建议）

**P1（会影响分数和理解）**
1. 路由模式加一行解释或改名。例如在 Three-tier 下写 "AI 走家宽 · 视频走云 · 其他直连"，Stable 下写 "全部走云"，或者直接用能说明效果的名字；Settings 里的同名说明同步修改。
2. 把齿轮和 "Details ⌃" 在视觉上分开：拉开间距，或加分隔，或把齿轮放回顶栏，避免读成一个控件。保留 44 pt 的命中区。
3. Check 遇到空输入或无效域名时，在答案位置给出一行提示，例如 "输入一个网址，如 claude.ai"；并补一个 XCUITest：查询 example.com 后把输入改成 example.org，断言 routeAnswer 消失，然后再提交。

**P2**
4. `testZZRealWidgetInTheSystemGallery`：对 `placed` 做 `XCTAssert`；在它之前结束预览 Live Activity，以免污染主屏截图；如果可行，给小组件写一份非 unavailable 的共享快照，证明系统主屏上的 connected/stale 文案。
5. 交叉淡化时，计时器和流量行要么延后出现，要么与旧值不同时绘制，避免 "184/4 K" 和 "47:00" 叠在填充上。
6. 让 Reconnecting 的静态天空和 Partly working 的差异更明显，例如太阳更低或光晕更冷。
7. `setMode` 的 reload 被拒时，回滚 `mode`，或者给查询答案标注"未生效"（S4，源码推论）。
8. Increase Contrast 下把 textSecondary/textTertiary 提一档；英文的 "Home in …" 可以改成 "Home exit · United States"。

**P3 / 真机**
9. 在真机上走一遍 VoiceOver（顺序、查询公告、magic tap），检查触觉反馈，并在连接状态下抽一段耗电与发热样本。
10. sheet 的 smoke 可以考虑降到能看出玻璃层次，但要保证 Home 的标题不透出来。需要实拍对比后再定。

## 证据清单（本地）
- 本报告：`/home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-blind-review-opus-5-5.md`
- 证据目录：`/home/user/workspace/repo/.amp/in/artifacts/pr1672-r9-evidence/`
  - `m_A…m_N.jpg`：65 张截图按 4 张一组的带标签拼图
  - `grid_state-cycle-en.jpg`、`grid_sheet-zoom.jpg`、`grid_state-cycle-reduce-motion.jpg`：视频每秒一帧
  - `hi_grid.jpg`：state-cycle-en 在 1.8/2.1/2.4/2.7/17.3/17.7/18.1/18.5 s 的过渡帧
  - `rm5_grid.jpg`：Reduce Motion 视频按真实 pts 抽出的 0.77–4.27 s 帧
  - `ut_grid.jpg`：ui-tests.mp4 在 586–590.5 s 和 599–606.5 s 的帧
  - `cmp_a11y.jpg`：默认、增强对比、减少透明度三态对比
  - `crop_lt_conn.jpg`：AX5 下 connected 页底部
  - `artifact-sha256.txt`：77 个 artifact 文件的 sha256
- 原始 artifact：`/home/user/workspace/repo/.amp/in/art9/`；源码 worktree：`/home/user/workspace/repo/.amp/in/src9`（detached，位于 b36d07d）
