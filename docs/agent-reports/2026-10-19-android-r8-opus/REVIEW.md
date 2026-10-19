# PR #1673 第 8 轮独立盲审（Android 移动端）

- 评审线程：https://ampcode.com/threads/T-01a151dc-b7e8-77ee-912b-6609a0b64adb（独立完成，未咨询其他评审或实施线程，未另建线程）
- 固定源码：`1cb5b59bb9d25335d185c3ec5c588192f24a36a6`（本地只读 worktree `/home/user/workspace/r8src`）
- CI：android-ci run `39184008733`，attempt 1，conclusion success，headSha 与固定源码一致
- 读取范围：固定源码；本 run 的原始 artifact（tunnel 12157754971、system 12157692258、ui 12157169775、JVM 12157945155）；证据评论 issuecomment-6257957522。
  未读：其他 PR 评论、旧评分、其他评审/实施线程、密封自评、`docs/agent-reports/` 其他报告、带旧分数的 rubric 来源文件。证据评论内嵌的 ampcode 图片未打开，图像均取自 CI 原始 artifact。
- 未修改产品代码，未提交、推送或在 GitHub 发帖。

证据标记：**[执行]** = CI 中实际运行的测试或日志；**[视觉]** = 我看过的截图或视频帧；**[源码]** = 读源码得到的推论，未在设备上验证。

## 结论

| 项 | 满分 | 得分 | 占比 |
|---|---|---|---|
| 信息层级减字 | 20 | 18 | 90% |
| 交互连贯单手 | 20 | 16 | 80% |
| 高级克制及最新桌面品牌一致 | 15 | 13 | 87% |
| Liquid Glass 材质 | 15 | 11 | 73% |
| 状态动效 | 15 | 11 | 73% |
| 可访问性适配 | 10 | 8.5 | 85% |
| 真实性性能 | 5 | 3.5 | 70% |
| **总分** | **100** | **81** | — |

- 一票否决：**不触发**（理由见 §2，属于我的判断，有边界）。
- 各项均 ≥70%（“真实性性能”刚好 70%）。
- **总分 81 < 85：本轮不通过。** 我没有把分数往用户 ≥95 的目标上凑。

## 1. 独立核验的计数与失败

- JVM 原始 XML [执行]：mobile 发现 49、跳过 17（ScreenshotRender 15 + MotionPreview 2）、执行 32、失败 0、错误 0；routing 执行 16、失败 0。与证据评论一致。
- 设备测试 [执行]：system 9/9 一次通过（健康门槛帧时 400 ms）；ui 12/12 一次通过（600 ms）；tunnel 重试 9/9 加 `t1-routing-matches-exit-logs`，`summary.txt` 写明 “FLAKY … passed only on the fresh-emulator retry”（800 ms）。合计 30 项设备测试 + 1 项路由核对 = 31。
- tunnel 第一次尝试（`evidence-attempt-1792373454`，950 ms）：t1 在 `requestCode()` 失败，报 `AssertionError: code step`（LocalTunnelDeviceTest.kt:240，等待 “6-digit code” 20 s），路由核对随之失败；b1–b3、t2–t5 通过。我自己查到的事实：
  - 01:23:35.755 点击 “Send a sign-in code”；01:23:36.299 `:vpn`（pid 7309）发出请求；替身控制面在 01:23:36 记录 `POST /auth/email/start 200`。
  - 应用进程 7244 在约 01:23:37.6 之前画了几帧（其中两帧 Davey 分别是 713 ms 和 951 ms），之后约 18 s 没有任何 `app_time_stats`，也就是界面不再重绘。
  - 没有异常、ANR 或 FATAL，没有失败截图。
  - 原因仍未查明。可能是模拟器过载，也可能是“发码后”的快照没有送到或没有渲染到界面。后者若属实，就是主流程卡死。这一项我只扣分，不作否决。
- 旧 run 39181991820 未作为基线（按要求）。

## 2. 通知自检（重点）

源码事实 [源码]：
- `SystemSurfaces.publish` 在隧道相关阶段（PREPARING、CONNECTING、CONNECTED、DEGRADED、DISCONNECTING）每次写共享状态时，调用 `NotificationWatchdog.arm`，设一个 `AlarmManager.set(ELAPSED_REALTIME, now + 40 s)` 的闹钟（非精确、不唤醒）。心跳 30 s 一次：隧道建立后，流量任务每秒调用 `update()`，`publish` 每 30 s 至少重写一次状态。
- 接收者是 `NotificationWatchdog$Receiver`，在 manifest 里没有指定 process，所以运行在主进程。它判断通知还能被担保的条件是：本次开机、记录未过期（≤90 s）、而且声称 CONNECTED/DEGRADED 时系统确有 VPN 网络。不能担保就把通知替换为 “Tono stopped · No VPN network”（系统无 VPN 时）或 “Status unknown”。
- 引擎正常离开隧道阶段时会 cancel 这个闹钟。

实测 [执行]（重试轮的 `local-tunnel-t5.txt`）：
- 前提：MainActivity 已关闭；dumpsys 中应用对引擎的绑定 `hasBound=false`，只剩系统的 VpnService 绑定。
- 杀进程后 511 ms 旧进程消失、VPN 网络消失。ActivityManager 记录 `has died: prcp FGS`，Android 没有重启引擎。
- 采样：`511ms vpn=false title=Connected phase=CONNECTED` 一直持续到 `57410ms vpn=false title=Tono stopped`。看门狗日志：`replaced a stale CONNECTED notification (surface UNKNOWN, VPN network false)`。
- 第一次尝试：57.8 s，结果相同。
- 截图 local-19 / local-20 [视觉]：通知从 “Connected · Cloud United States · Home United States · Disconnect” 变为 “Tono stopped · No VPN network · Open Tono to reconnect”。中间约 57 s 只有采样文本，没有截图。
- 测试允许的上限是 `STALE_MS` = 90 s（没有 VPN 却仍声称已连接，超过 90 s 才判失败）。实测 57 s 在这个上限内。

我的判断：**这个窗口仍然误导保护状态，但不构成“严重状态误导”的一票否决。**
- 仍然误导：约 1 分钟内，Tono 最显眼的常驻系统表面（通知）写着 “Connected” 并带 Disconnect，而这时流量已经不走隧道。
- 不否决的理由：
  - 这是应用未打开时引擎进程意外死亡这一低频故障。
  - 窗口有界，并且会自动改写为明确的 “Tono stopped · No VPN network”。
  - 同一时刻，系统钥匙图标立即消失（截图可见）；Quick Settings 磁贴打开时会重读 `vpnPresent`，判为 UNKNOWN [源码]；应用一打开就显示 “Status unknown”（t1 前台实测 454 ms）[执行][视觉]。
  - 如果 owner 认为任何非零窗口都不可接受，这条结论就会翻转。我明确标出这一点，不靠绿色 CI 或修复宣称来撤销风险。
- 未覆盖、不可外推的边界：
  1. 主进程不在：测试中主进程承载测试本身，闹钟送达的是运行中的进程，冷启动送达未验证。
  2. Doze、App Standby 分组、OEM 自启动限制下的送达时延未验证，理论上可能远超 70 s。
  3. 设计上，手机醒着时窗口约为最后一次写入后 10–70 s，加上非精确批处理，不是严格上界。
  4. widget 依赖同一刷新路径或自身约 100 s 的复查；“已连接 widget + 引擎死亡”没有在设备上实跑。
- 次要源码边缘 [源码]：引擎活着但长时间停在 PREPARING 且不写状态时，90 s 后看门狗会把它的通知改为 “Status unknown”。属于保守方向，不是泄漏方向。

## 3. 真实 MainActivity t1/t2/t4/t5 与界面观察

- t1 [执行][视觉]：
  - 真实登录 → Connect → Tono 说明 → 系统授权框 → Connected，系统出现钥匙图标。
  - 杀掉 `:vpn` 后首页显示 “Status unknown · Tono stopped responding · checking again”，场景切为夜景月亮，计时器和流量隐藏（local-04b）；之后 “Connected 00:03” 恢复（local-04c）。
  - 1.5 s 宽限只在移除动画下验证；回前台的首帧没有录制。
- t2 [执行][视觉]：
  - 带键盘转横屏，验证码保留 “246”，输入框在键盘上方。
  - cutout 的检查确实断言非空：90° 为 `Rect(0,470–128,588)`，270° 为 `Rect(2272,492–2400,610)`（显示 2400×1080）。Home 90°、Details 90°、Home 270° 均为 `[nothing]`。
  - 修正一处表述：排除项不止 “Close sheet”。`underCutout` 还排除了 local-test-server 标记节点，以及没有 text/desc 的节点。无标签可点节点另由 A11yContract 抓。
  - 授权说明转屏后仍保留。
- t4 [执行][视觉]：200% 字号下，登录、验证码、首页的未连接、**真实** Connected、Partly working、Didn't connect，以及 Details、设置，均无截断，控件 ≥48 dp 且有标签。
  - A11yContract 的宽度检查是“行宽 > 自身文本框”，抓不到被父容器裁掉的文本；JVM 上测不出，宽度项实际在设备副本上生效。
  - 视觉瑕疵：200% 登录页的月亮与导语第二行 “— no password.” 重叠，仍可读。
- t5：见 §2。
- 五态（t3，真实应用连本地替身）[视觉]：
  - Not connected（月亮）、Connecting（半日 + Cancel 进度条）、Connected（满日、绿点、Disconnect 计时）、Partly working（低日、橙点、“Home check failed · AI paused”）、Didn't connect（红点 “Lines unavailable right now” + Retry）。
  - 问题：**失败态的场景仍是暖色天空加半轮太阳，与 Connecting 很像**，只靠文字、红点和 Retry 区分。
  - fixture 动效中，Disconnecting 阶段仍保留满日；真实录屏中 Disconnecting 已切到夜景，但副标题显示 “Pick a line and connect.”，与 “Disconnecting…” 并列，略有不一致。
- 文案 [视觉]：
  - “Lines unavailable right now / 线路暂不可用” 已到位。
  - 读屏顺序为 “Disconnect, Tunnel up for 23:00 … (Partly working)”，部分可用时不读 “Connected”。
  - 设置页清楚提示 “Not always-on: if Tono stops, apps go out directly” 并提供 Open VPN settings。
- 登录 [视觉][源码]：发码后验证码输入框不会自动获得焦点（源码中没有 FocusRequester），单手需要再点一次。录屏 2 fps 抽帧中有一帧 “Verifying…” 时数字与浮动标签重叠，属于程序化 setText 的过渡帧，我只记录，不定性。
- 品牌 [视觉]：Android 登录图标、通知小图标与 macOS AppIcon、Windows 128@2x 图标是同一个“地平线落日”标志，暖橙渐变一致。Settings 和 Details 克制，层级清楚。
- 玻璃 [执行][视觉]：
  - u4 条纹实验：裸背景条纹幅度 162.5，Tono 玻璃 0.1，同玻璃无模糊 83.2；边缘谐波 22%，裸背景 34%。模糊确实生效。
  - 但在深色渐变背景上，胶囊基本表现为深色烟玻璃，缺少高光边、折射或环境色。观感偏“暗磨砂”，不算出色的 Liquid Glass。
  - 只在软件 GPU 上测过；真机的观感和开销未验证。
- 动效 [执行][视觉]：392 帧（16 ms 测试时钟）覆盖 IDLE→PREPARING→CONNECTING→CONNECTED→DISCONNECTING→IDLE→FAILED；关闭动画时场景冻结（0.0000%）。
- 性能：`perf.txt` 记录 70 帧，98.6% janky，p50 350 ms（软件 GPU）。准入门槛（帧时 ≤1000 ms）只是模拟器准入，**不是性能结论**；真机流畅度未知。
- 未验证：Tono 真实服务、真机、TalkBack 实际朗读、电量。我没有说任何未测的场景存在泄漏或不存在泄漏。

## 4. 分项理由（摘要）

- 信息层级 18/20：每屏一个状态词、一行原因、一个主操作；Details 用 “What happened” 解释部分可用。扣分：Connected 副标题略长；设置页信息偏密。
- 交互单手 16/20：主操作在拇指区；授权前先说明；转屏不丢状态；键盘焦点和无障碍操作可用。扣分：t1 首轮主登录步骤卡住，原因未明；验证码框不自动聚焦；“Status unknown” 时只给 Disconnect。
- 品牌克制 13/15：与最新桌面图标一致，暖橙克制。扣分：失败态和 Disconnecting 的场景语义偏暖；200% 时月亮压字。
- 玻璃 11/15：模糊有实测，但材质层次单薄，真机未验证。
- 状态动效 11/15：五态加 Status unknown 在应用内诚实；扣分来自 §2 的通知约 57 s 窗口及其未验证边界、失败态与连接中的场景近似。
- 可访问性 8.5/10：200% 真实状态、48 dp、标签、读屏顺序、小屏、横屏、270° cutout、中文均有设备证据。扣分：TalkBack 未实听；父容器裁切检测有盲区；200% 月亮压字。
- 真实性性能 3.5/5：真实应用、引擎、VPN 加明确标注的本地替身，证据真实。扣分：tunnel 片 FLAKY 且主流程失败原因未明；性能无真机证据。
