# Tono Android PR #1673 第 6 轮独立盲审（Claude Opus 5.5，claude-opus-5-5）

- 仓库 / PR：raydocs/tono#1673（Draft，OPEN），分支 `feat/android-singbox-horizon`
- 固定 head：`bf449391feacb3fdc329680ca7115aea8397659a`（`gh pr view` 核对 headRefOid 一致）
- CI：android-ci run 39138009249，event pull_request，headSha 同上，最终 attempt 2 = success
- 评审线程：https://ampcode.com/threads/T-01a14fea-9e0f-7738-a0b8-fb8ba6aad8cd
- 本地工作目录：`/home/user/workspace/repo/.amp/in/`（head worktree `head/`，CI 证据 `ci/`，拼图 `mont/`）

## 0. 披露（必读）

- Rubric 只读取了 `docs/agent-reports/2026-10-18-mobile-opus-5-5.md` 第 8–23 行（“Rubric（原样，不改标准）”一节）。
- **意外看到的旧分数**：为了定位该节，运行了 `grep -n '^#'` 列标题，标题行本身带出了旧结论：“二、iOS #1672 评分（head `159ebad`，83/100）”“三、Android #1673 评分（head `c53eba6`，79.5/100）”。Rubric 一节正文也写着“iOS 自评 91/100”。这些分数没有读正文、没有用作依据，但如实披露：我看到了这些数字。
- 未读 PR 正文/评论、其他 agent-reports、实施笔记、62fee220 自评分、当前密封自评分；未联系实施线程或其他评审；未发布 GitHub、未改代码。

## 1. Rubric（原样引用）

D1 信息层级/减字 20（14）· D2 交互连贯/单手 20（14）· D3 高级克制+最新桌面品牌一致 15（10.5）· D4 Liquid Glass/玻璃材质 15（10.5）· D5 状态动效 15（10.5）· D6 可访问性/适配 10（7）· D7 真实性/性能（工程）5（3.5）。
通过 = 总分 ≥85 且每项 ≥70%；一票否决：严重状态误导、主操作难发现、不可读。

## 2. CI 事实（从日志与 artifact 核对）

| 作业 | attempt | 结果 | 时间 | 说明 |
|---|---|---|---|---|
| build 117706395844 | 1 | success | 14:53–14:58 | attempt 2 复用 |
| emulator (ui) 117707505287 | 1 | success | 14:58–15:08 | u1–u9、l1–l3 共 12/12 首次通过（含 l3，15:08:03 PASS） |
| emulator (system) 117707505292 | 1 | **failure** | 14:58–16:22（84 min） | 见下 |
| emulator (system) 117726395167 | 2 | success | 16:24–16:37 | 同一 head 只重跑 system；单个模拟器 13/13 + `t1-routing-matches-exit-logs` PASS，无作业内重试 |

**system attempt 1 失败记录**（artifact 12143211019）：
- 第一个模拟器（`evidence-attempt-1792337935/summary.txt`）：a1 PASS（单测 5 分 14 秒），**a2 FAIL、a3 FAIL**，然后 2186 s 处 TIME-BUDGET 停在 a4 前。a2、a3 都是在 `timeout 900` 处被杀（15:07:05→15:22:05、15:22:05→15:37:05），instrument 输出没有 `OK (`，也没有断言信息，因此不是产品断言失败，而是挂起超时。`foreign-anr.txt`：“VpnDialogs isn't responding → Wait”。logcat：15:00 launcher ANR；a2 期间 `app_time_stats avg=314ms`，15:10:38 系统批量杀进程。
- 第二个模拟器（`evidence/summary.txt`）：a1–a6、s1–s3、b1 共 10 个 PASS，2566 s 时 TIME-BUDGET 停在 b2 前。这一次没有 FAIL。
- 结论：任务简报说“两个模拟器极慢，触到 35 分钟预算后停止”，这句话准确但不完整：第一个模拟器还记录了两条 FAIL（per-test 900 s 超时）。同一测试在 attempt 2 里 a1 只用了 35 s，a2 用了 53 s，可见是宿主环境的方差。**不能说首次全过**：总计 25/25 + 分流核对 = UI 12（attempt 1）+ system 13（attempt 2）+ routing。

**Artifact 核对**：测试 APK sha256 `79ccae83…d333`，与 `.sha256` 文件一致，source 行 = bf449391。PNG 共 48 张 = UI 18 + system(attempt 2) 30；real 14 / fixture 29（18+11）/ local 5，与简报一致。**视频**：只找到 1 个文件，即 `fixture-motion.mp4`（21.0 s，131 帧，约 6 fps，1080×2400）；另有 u8 的 392 张 60 fps JPG 帧序列（`frames/`）。在这三个 evidence artifact 里**没有找到第二个视频文件**，所以简报中的“2 视频”我无法核实；如果它把帧序列算作一个视频，数字就对得上。

**t1 local-TUN**（`local-tunnel-routing.txt` 与 `local-tunnel/exits.log` 交叉核对）：cloudflare 和 youtube 只被 cloud exit 看到；claude.ai 和 api.anthropic.com 只被 Home 看到，且 Home 经 cloud 链式到达（cloud→198.20.0.11:21080）；example.com 两个 exit 都没看到，手机侧 HTTP 200。另外 exit 日志里 mtalk.google.com:5228 走了 Home，这符合 `DesktopRoutingContract` 中 `google.com` 属于 Home 组的设计。连接耗时 11.3 s（软件 GPU 模拟器）；PSS：app 80 MB，:vpn 77 MB。边界：exit 是 CI 主机上的 pinned sing-box CLI，控制面是本地 fixture，请求来自同 uid 的 instrumentation 进程；**与真实 Tono 服务、真实账号、第三方 App 分流、per-app 排除都无关**（测试 docstring 自己也这样写）。cloudflare/claude.ai 两行里的 `engine-probe` 是测试代码写死的字符串，靠 exit 日志才得到证实。

## 3. 截图 / 视频观察（只陈述画面所见）

横屏：
- `fixture-27-landscape-home.png`（2400×1080，report 写 866×363 dp）：画面右上角是 `FIXTURE · no tunnel`。内容列宽度受 560 dp 上限约束，太阳放在右侧，Disconnect、线路、dock 都可见，未被截断。左侧有约 128 px（≈48 dp）的黑色 letterbox 带，2400 px/2.625 = 914 dp，减去 866 dp 正好对上，说明窗口被排除在 cutout 区域之外。“Home not answering · AI paused”贴在海平线上，仍然可读。
- `fixture-27-landscape-details.png`：Details 面板占约 70% 宽，只能看到 What happened 和前两条去向（Video 行被底边切到，需要滚动）。拖动手柄外面有灰色方形焦点底，**上方浮出 “Drag handle” tooltip**。
- 同样的 “Drag handle” tooltip 和灰方块也出现在 `fixture-14-font-2.0-details.png`（遮住了标题 “Tono” 的右侧）和 `fixture-26-small-phone-details.png`。没有出现在 `fixture-06`、`fixture-09`、`local-04` 中。
- `landscape-report.txt` 里写着 “Tono's window in front”，但源码显示 l3 用的是 `ActivityScenario.launch(ComponentActivity::class.java)` 加 `FixtureFrame{TonoRoot(fixture)}`，并且 `LocalReduceMotion=true`，**不是 MainActivity**。所以这是 fixture/测试宿主的横屏证据，**不能**当作真实 MainActivity 横屏验收，更不是真机证据。登录页在横屏下只有截断和 a11y 断言（check 循环里的 signin 状态），没有截图。

其他：
- `fixture-21..24-zh-*`：**没有 FIXTURE 角标，也不是 edge-to-edge**（状态栏是一条独立的深色带，见 `artifacts/tops.png` 中 zh 与 en 顶部的对比）。这 4 张 fixture 图看起来会像真实 App。
- `fixture-10-lines-sheet.png`：Lines 面板上方露出被切了一半的大标题 “Partly working”。
- `real-11` 和 `real-12`（亮色/暗色系统主题）画面一致：App 固定使用夜色主题。a6 只断言标题存在，测试名里的 “Honours” 名不副实。
- `real-01..12` 全部是未登录的 sign-in 界面，真实 MainActivity 的已登录 Home 只出现在 `local-02..05`（本地服务器，角标为 “Local test server · not Tono”）。
- `local-03-connected`：线路行 “Local test” 是灰点、没有延迟，速率显示 0 B/s。`fixture-05-failed`：Didn't connect / Home exit unavailable，同时线路 Tokyo 是绿点 86 ms（轻微混合信号，不构成误导）。
- `fixture-17` widget 的 “Status unknown · Last known: Connected at 4:22 PM”：过期状态表达诚实。`fixture-18/19` 通知带 FIXTURE 前缀。
- `fixture-16-glass-blur.png` 与 `glass-report.txt`：合成条纹测试中，Tono glass 让条纹振幅从 162.5 降到 0.1，无 blur 时是 83.2，说明 API 31+ 下真实使用了 RenderEffect 模糊。
- `fixture-25-keyboard-focus.png`：Disconnect 胶囊外有清晰的金色焦点环。`keyboard-report.txt`：Tab 顺序为 primary→exit→settings→details，环像素变化 72/74/33/50%，Shift+Tab×3 后 Enter 触发 disconnect，ACTION_CLICK 四个控件都通过。
- 视频 `fixture-motion.mp4`：0–1 s 是 launcher，2 s 黑屏，3–5 s Not connected，**约 6.0 s 那一帧大标题、副标题、胶囊文字同时消失**，7–8 s Connecting 带进度填充，9–11 s Connected，12 s Disconnecting，13–15 s Not connected，16 s Connecting，17–19 s Didn't connect，20 s 白帧（录制结尾）。
- u8 的 60 fps 帧（`artifacts/u8.png`）：frame-0028（448 ms）标题被裁成 “Not connectec”；**frame-0030 至 0034 左右（480–544 ms），状态标题和主胶囊都没有文字**，约 64–100 ms。原因是退出淡出与进入淡入几乎首尾相接。这只是动效瑕疵，不构成状态误导。
- `perf.txt`：100% janky，p50 300 ms，GPU p50 4950 ms。这是 swiftshader 模拟器上的数字，对真机没有参考意义。

## 4. 源码推论（未动态复现、未在真机上验证）

1. **真实 MainActivity 横屏的 cutout**：`MainActivity.onCreate` 在 super 之前调用了 `enableEdgeToEdge`（activity-compose 1.12.4；API 30+ 下 cutout 模式为 ALWAYS）。`HomeScreen` 只用了 `statusBarsPadding`、`navigationBarsPadding` 和 20 dp 水平 padding，全仓只有 `SignInScreen` 用到 `WindowInsets.safeDrawing`。推论：真机横屏时 Home 的标题行和胶囊可能会压进打孔区。l3 的测试宿主把 cutout 区 letterbox 掉了（截图左侧那条 48 dp 黑带），所以测不到这个问题。
2. `pendingConsent` 是 Activity 上的普通 `mutableStateOf` 字段。推论：说明面板（ConsentSheet）打开时旋转屏幕，Activity 重建，面板会消失。用户再点一次 Connect 就能恢复，属于低风险。
3. CI 上从未在真实 MainActivity 里跑过 “ConsentSheet → 系统对话框” 这条链：a2 直接调用 `startActivityForResult(prepare)`；t1 运行时 a2 已经授过权，所以 `local-tunnel.txt` 里没有 “consent:” 记录；u5 只是 fixture 宿主中的 ConsentSheet 组件（点击 Continue 只计数）。
4. 横屏、2.0 字号和小屏 details 截图里的 “Drag handle” tooltip，推测是测试顺序造成的：u9 发送了真实按键，设备退出 touch mode，之后 M3 `BottomSheetDefaults.DragHandle` 获得焦点并显示 tooltip。真实键盘用户打开面板时可能也会看到同样的 tooltip 遮挡头部。这一点未验证。
5. zh 截图缺角标，推测与 `show(locale)` 覆盖 `LocalContext`/`LocalConfiguration` 后 `FixtureFrame` 的 edge-to-edge 没有生效、`statusBars` inset 为 0、`StatusBandMark` 高度为 0 有关。这是推测，未验证。
- 以上没有一条是泄漏，也没有动态复现。

## 5. 评分

| 维度 | 满分 | 70% 线 | 得分 | 依据 |
|---|---|---|---|---|
| D1 信息层级/减字 | 20 | 14 | **17** | 首屏只有状态、一句原因、主胶囊、线路、dock，层级清晰。Details 的 “What happened” 一句话说清 fail-closed，中英文都没有截断。扣分：Settings、Consent 的段落仍偏长；“Local direct”“Three-tier” 偏术语。 |
| D2 交互连贯/单手 | 20 | 14 | **17** | 主操作全部在拇指区，dock 支持上滑，横屏列宽有限制，Tab/Enter/ACTION_CLICK 都通过，8 个状态下 primary 的动作正确（interaction-report）。扣分：真实 MainActivity 横屏未验证（cutout 推论）；ConsentSheet→系统对话框在真实 App 中未跑；Lines 面板上方露出半截标题；旋转会丢失 consent 面板（推论）。 |
| D3 高级克制+桌面品牌 | 15 | 10.5 | **12.5** | 日出/月夜海平线语言统一、克制，暖橙主色只给主操作，角标诚实。扣分：Details/Lines/Consent 是标准 M3 不透明面板，与主屏的玻璃质感不一致；“Drag handle” tooltip 和灰色焦点方块破坏了画面；系统主题固定为暗色。本轮没有拿桌面端截图逐项对比，“与最新桌面一致”只按同一视觉语言判断。 |
| D4 玻璃材质 | 15 | 10.5 | **11** | API 31+ 使用真实 RenderEffect，共享一次场景录制，加烟色 tint、顶部高光和描边，合成测试证明了模糊。扣分：在深色海面上看起来主要是深色带边胶囊，透出的层次很弱；面板不是玻璃；没有折射或镜面这类 Liquid Glass 特征（Android 上可以理解，但这一维按材质观感打分）。 |
| D5 状态动效 | 15 | 10.5 | **12.5** | 太阳升落与状态一一对应，Connecting 时胶囊有进度填充，Disconnecting 有过渡，Failed 时太阳半沉。a5 证明系统“移除动画”生效（0.39%→0%）。扣分：u8 的 frame 30–34 出现约 64–100 ms 的无文字空白，frame 28 标题被裁；视频约 6.0 s 处同样空白。 |
| D6 可访问性/适配 | 10 | 7 | **8** | 2.0 字号、360 dp 小屏、横屏（fixture 宿主）、简体中文全部做了截断和 48 dp/标签断言，焦点环可见，ATF 检查和读屏顺序合理。扣分：TalkBack 不在镜像中，语音未测；横屏只在测试宿主上验证；真实 MainActivity 的 cutout 未覆盖；tooltip 遮挡标题。 |
| D7 真实性/性能 | 5 | 3.5 | **3.5** | 真实 VpnService/TUN、libbox 和 exit 日志分流核对属于强证据，所有界面都诚实标注 FIXTURE/Local。扣分：zh 的 4 张 fixture 截图缺角标；system shard 不稳定（attempt 1 的两条 FAIL 是 900 s 挂起，加两次预算停止，要靠重跑才变绿）；没有真机、没有真实服务、性能数据只有软件 GPU 上的。 |
| **合计** | 100 | 85 | **81.5** | |

- **门槛**：每项都 ≥70%（D7 正好 3.5/3.5 卡在线上），**总分 81.5 < 85，不通过**。
- **否决**：不触发。没有严重状态误导（Partly working、Didn't connect、Status unknown 都表达明确，“AI paused, not sent direct” 讲清了 fail-closed）；主操作显眼；没有不可读的文字（2.0 字号和 zh 都无截断）。

## 6. 优先建议（按收益排序）

1. **补一条真实 MainActivity 横屏验收**：用 `ActivityScenario.launch(MainActivity)` 拍横屏 sign-in；用 LocalTestServer 登录后拍横屏 Home 和 Details。Home 列与顶栏改用 `WindowInsets.safeDrawing`（至少 `displayCutout`）的水平 padding。在此之前，横屏只能算 fixture 证据。
2. **去掉 sheet 截图里的 “Drag handle” tooltip**：l1–l3 前恢复 touch mode，或者把 u9 放到最后。同时确认真实键盘用户打开面板时 tooltip 不会遮住头部（fixture-14、26-small-phone-details、27-landscape-details）。
3. **修复 zh fixture 截图缺 FIXTURE 角标、非 edge-to-edge 的问题**（fixture-21..24），否则证据标签不诚实。
4. **状态切换改为重叠交叉淡化**（进入不要等退出完全结束），并避免标题在动画中被裁，消除 u8 frame 28–34 和视频约 6.0 s 处的空白帧。
5. **稳定 system shard**：把 per-test 900 s 挂起改为更短的超时，超时前 dump 窗口层级；开测前加健康门槛（boot_completed、launcher 空闲、一次 gfxinfo 帧时探测，帧时异常就直接换模拟器）；考虑把 system shard 拆成两片。报告中把“重跑后通过”标成 flaky。
6. **在真实 App 中跑一次 ConsentSheet→系统对话框**：t1 前用 `appops`/`cmd` 撤销 VPN 授权，或调整顺序，让 `local-tunnel.txt` 出现 “consent: Tono's explanation shown”。
7. 把 `pendingConsent` 改为可在旋转中保存的状态（推论项）。
8. 玻璃：按 sky 状态调整 tint，让夜色下也能看出透射层次；Details、Lines 面板考虑使用同一种玻璃，或者说明为什么不用。
9. a6 要么断言主题行为，要么改名，并把“固定暗色”记录为设计决定。
10. Local 已连接时线路行给出延迟或状态点，不要只显示灰点。

## 7. 未验证项（不能冒充通过）

真机（任何 Android 硬件）、真实 MainActivity 横屏、TalkBack 实际朗读与手势、真实 Tono 服务与账号、第三方 App 分流及 per-app 排除、真机性能与耗电、与桌面端逐屏的品牌对比。

## 8. 证据清单（本地路径）

- CI 日志：`/home/user/workspace/repo/.amp/in/ci/{build,ui-a1,sys-a1,sys-a2}.log`
- Artifact：`ci/a-12141320388/`（UI）、`ci/a-12143093299/`（system attempt 2）、`ci/a-12143211019/`（attempt 1 失败记录，含 `evidence-attempt-1792337935/`）、`ci/a-12140558090/`（测试 APK + sha256）
- sha256 前缀：landscape-home `d7a181cd…`、landscape-details `026e236f…`、landscape-report `f24f0f32…`、fixture-motion.mp4 `a8b1a4c2…`
- 拼图 / 裁切：`/home/user/workspace/repo/.amp/in/mont/*.png`；关键图已复制到 `/home/user/workspace/repo/.amp/in/artifacts/{u8.png,t.png,tops.png}`
- 源码（head worktree）：`.amp/in/head/apps/android/mobile/src/androidTest/.../ScreenSizeDeviceTest.kt:131-186`、`HorizonUiDeviceTest.kt:82-102,253-265,319-345,402-495`、`LocalTunnelDeviceTest.kt`、`DeviceEvidenceTest.kt:114-165,230-245`、`DeviceFixtures.kt:80-95`；`main/.../ui/MainActivity.kt`、`HomeScreen.kt:124-150`、`Glass.kt`、`TonoRoot.kt`、`Components.kt:118-141`
