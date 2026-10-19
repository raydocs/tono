# raydocs/tono PR #1673 第 7 轮独立盲审（Android）

- 评审者：Claude Opus 5.5，Amp 线程 T-01a15171-0ef1-765a-a2a7-1de1deaab907；没有另建线程，没有咨询其他评审。
- 固定源码：`c18daa3db114fb059e1190e6e0e7aa7635f715b9`（PR headRefOid 与 `repos/.../commits/c18daa3db` 都解析到这个完整 SHA；本地 detached worktree `git rev-parse HEAD` 一致）。
- CI：android-ci run 39176556620，attempt 1，event pull_request，headSha 与上面一致，conclusion success。jobs：build 117820321742、emulator(ui) 117821286651、emulator(system) 117821286663、emulator(tunnel) 117821286672。
- 输入范围：固定源码、原始 job 日志、run artifacts（ui 12155260564、tunnel 12155056933、system 12155007330、test-reports 12154588071，zip 的 SHA256 与 GitHub digest 一致），以及证据评论 #6256737598。旧失败 run 只用来查事实（39170392763 的 tunnel artifact），不参与评分。
- 披露：按 rubric 节标题定位时，`grep '^#'` 输出了该文件的章节标题，其中带有旧分数（“iOS … 83/100”“Android … 79.5/100”）；rubric 节正文里还有“iOS 自评 91/100”。这些分数没有被参考。没有读其他 PR 评论、其他报告、实施线程或密封自评。
- 未修改产品，没有提交、推送或发布到 GitHub，没有联系实施方。

## 结论

| 维度 | 满分 | 70% 线 | 得分 |
|---|---|---|---|
| D1 信息层级 / 减字 | 20 | 14 | **17.5** |
| D2 交互连贯 / 单手 | 20 | 14 | **17.5** |
| D3 高级克制 + 与最新桌面品牌一致 | 15 | 10.5 | **12.5** |
| D4 Liquid Glass / 玻璃材质 | 15 | 10.5 | **11** |
| D5 状态动效 | 15 | 10.5 | **11.5** |
| D6 可访问性 / 适配 | 10 | 7 | **8.5** |
| D7 真实性 / 性能（工程） | 5 | 3.5 | **3.5** |
| **总分** | 100 | ≥85 | **82 / 100** |

- **未通过**：总分 82 < 85。所有单项都达到 70%，D7 恰好在线上。离用户目标 ≥95 还差 13 分。
- **一票否决：未触发**（主操作难发现、不可读都没有；“严重状态误导”的判断见 §3）。
- **单独的发布阻塞项（不属于 rubric 否决）**：如果应用关闭期间引擎进程死亡，常驻通知会一直显示 “Connected”，而这时流量已经直连（§3）。这正是仓库 AGENTS.md 定义的“在保护已解除时显示受保护”，等级至少为 major。不论评分如何，修复或由 owner 明确接受之前都不应发布。

## 1. CI 声明的独立核对（执行事实）

| 声明 | 核对 | 证据 |
|---|---|---|
| UI 首次 12/12 | **属实**。job 步骤 “Install and run” = success，“Retry once” = skipped；没有 `evidence-attempt-*`；12 个 `instrument-*.txt` 都是 `OK (1 test)`，状态码只有 0/1，没有 -3（忽略）或 -4（假设失败）。health 中位帧 300 ms。 | jobs API；`art/ui/evidence/summary.txt` |
| tunnel 首次 8/8 | **首次通过属实，但计数口径有误**。Retry 步骤 skipped；b1–b3、t1–t4 实际是 **7 个** instrument，都是 OK；第 8 个 PASS 是 CI 侧的 `t1-routing-matches-exit-logs`，评论又把它作为“另加”单独算了一次。health 850 ms。 | `art/tunnel/evidence/summary.txt` |
| system 9/9，job 内重试后通过，FLAKY | **属实**。attempt 1 的 health 750 ms，s1 失败：`AssertionError: tile subtitle shows the shared status ("Sign in")`（SystemSurfacesDeviceTest.kt:128），`real-tile-panel.txt` 记录三次重开都是 “subtitle not shown”。重试 9/9，`Mark … flaky` 步骤 success，summary 带 FLAKY 行。失败保留在 `evidence-attempt-1792366741/`。 | 同上 |
| 合计 29/29 | 12+7+9 = 28 个设备测试，加 1 项分流核对 = 29。评论里写的是“设备测试 29/29，另加分流核对 1 项”，与实际不符，**少了一项**。准确说法是 28 个设备测试 + 1 项 CI 侧日志核对。所有测试都通过。 | summary 计数 |
| JVM 46 项、0 失败 | **属实**：`:mobile:testDebugUnitTest` 46 tests、0 failures、17 skipped（MotionPreview 2 项、ScreenshotRender 15 项，都是按需截图）。另有 `:routing` 16 项 0 失败，评论没提。 | test-reports artifact index.html |
| 没有删弱断言 | 在 androidTest 里比较 c31e69f（run 39163947970）与 head：没有删除任何 `assert` 行。579dfe7（run 39173982324）之后 androidTest 没有改动，只改了 EngineClient、TonoVpnService 和 JVM 测试（JVM 测试的断言更严格：要求新绑定真正连上）。 | `git diff` |

## 2. 7 项验收映射：是不是真实 MainActivity

- a1–a4（system shard）：`DeviceEvidenceTest` 里用的是 `ActivityScenario.launch(MainActivity::class.java)`。截图 real-01…05 是真实应用和 **Android 自己的** “Connection request” 对话框（`com.android.vpndialogs`）。a4 是引擎级检查，不经过界面：`libbox 1.15.0-alpha.12 … x86_64 checkConfig OK for [THREE_TIER, STABLE]`。属实。
- b1/b2 → t3：`LocalTunnelDeviceTest.t3` 启动的是真实 MainActivity，通过 `/fixture/scenario` 切换本地替身控制面的状态（normal / home-down / catalog-unavailable）。连接中、已连接、部分可用、失败都从屏幕上断言，部分可用和失败还检查了 VPN 网络（`vpnUp`）。天空亮度从截图计算：27.3 / 80.9 / 63.1 / 48.6，与评论一致，阈值（+30、+15/−5、+8/−10）在源码里，没有放宽。录屏 `local-real-motion.mp4` 1080×2400，172 s，444 帧（平均约 2.6 fps，软件 GPU），我抽帧看过，完整覆盖登录 → 授权 → 连接中 → 已连接 → 断开 → 部分可用 → 失败 → 设置 → 退出。**属实；不是夹具冒充。**
- b3 → t4：真实 MainActivity，`font_scale 2.0`，用 `createEmptyComposeRule` 跑 `A11yContract.truncatedText` 和 `violations`，报告写着 “no text cut off, every control ≥ 48 dp and labelled”。截图 local-15…18 我看过，没有截断。属实。
- 注意：ui shard 的 u1–u9、l1–l3 运行在**夹具宿主**上（截图角标 `FIXTURE · no tunnel`），只能证明组件在设备上的表现，不能当作真实应用验收。评论没有把它们算进 7 项，这一点没问题。
- t2（真实横屏）：真实 MainActivity，`show_ime_with_hard_keyboard 1`，竖屏键盘弹出后 `setRotation(90)`，断言已输入的 “246” 保留、IME 可见、输入框底边 ≤ 键盘顶边；横屏首页和 Details 做了挖孔检查；consent 说明打开时转回竖屏仍然保留。截图 local-06…09 与断言一致。属实。
- t1（引擎杀进程）：`Process.killProcess` 杀掉 `:vpn`，之后 90 s 内每 150 ms 采样一次首页、SurfaceRules 和通知。原始 logcat 时间线：23:40:26.508 `:vpn` 死亡（`prcp FGS`），同一毫秒 VPN 从 CONNECTED 变为 DISCONNECTED → **没有** “Scheduling restart … TonoVpnService” 记录 → 29.537 `Start proc …:vpn`（应用自己的 revive，+3.03 s）→ 32.295 新的 VPN CONNECTED（+5.8 s）。截图 local-04b 是 “Status unknown · Engine stopped · checking again”、夜空、主按钮 Disconnect；local-04c 是重新 Connected。回到桌面再回来，断言没有闪出 “Status unknown”。属实。t1 跑在 Remove animations 下（`animations.txt`）。

## 3. 残余问题：应用关闭时引擎死亡，通知仍显示 Connected

- **源码推论**：`TonoNotifications.replaceAfterEngineLoss` 只有一个调用点，即 `EngineClient.onServiceDisconnected`，运行在 UI 进程，前提是绑定还在。`EngineModel.onCleared()` 会 `unbind()`，UI 进程被回收后也没有任何绑定。TonoVpnService 返回 `START_STICKY`，但没有别的看门狗（没有 Job、Alarm 或 widget 去修正通知；widget `updatePeriodMillis` 30 min）。
- **执行证据支持前提成立**：本 run 的 logcat 里，系统没有为 Tono 安排引擎重启（重启来自应用）。旧 run 39170392763 的 t1（只查事实）在修复前记录到 `1813ms notification says Connected without a VPN network`，并持续下去。也就是说，应用不在时，“系统不重启引擎”很可能是**常态**，而不是偶发；通知会一直停在 “Connected · Cloud … · Home …” 并带着 Disconnect 按钮，直到用户打开应用。
- **未执行**：应用关闭这一场景本身没有被测试注入，以上结论来自源码推论加日志旁证。也没有注入真实流量，不能称为“已泄漏”。
- **为什么不判 rubric 否决**：应用内首页在引擎死亡时如实显示 “Status unknown”（执行证据）；磁贴、Widget 自己检查 VPN 网络（SurfaceRules）；系统状态栏的 VPN 钥匙图标会消失；设置页明确提示 “Not always-on: if Tono stops, apps go out directly… turn on Always-on VPN and ‘block connections without VPN’”（录屏中可见）。误导只出现在一个系统表面上，而且需要引擎故障才会触发。
- **但这是发布阻塞**：触发后的后果正是“显示受保护，而保护已解除”（AGENTS.md 中 major / 高 impact 的定义）。sing-box 用的是 alpha 版本，Go panic 会直接杀掉 `:vpn`。建议的方向（不由我实施）：让 `:vpn` 的常驻通知自带失效机制（例如引擎定期刷新、`setTimeoutAfter`），或者在 UI 进程外放一个绑定或检查（例如 JobScheduler 或磁贴检查时顺带改写通知）。

## 4. 测试条件披露的审核

- **非动效测试用 Remove animations**：合理。这是环境条件，不是断言条件，动效证据（a5、b2、u8、t3）保持动画开启，a5/t3 先静止启动再开启动画，录屏证明真实应用在动画开启时走完了全部状态。缺口：t1 的 1.5 s 重绘宽限是在无动画条件下验证的。动画开启时 AnimatedContent 的过渡会让旧文字多留几百毫秒，按源码看仍在宽限内，但**没有执行**。
- **开测前帧时门槛 1000 ms**：合理，不算弱化。它只决定是否开测，不影响任何断言；放宽门槛只会增加挂起风险，不会造成误判通过。副作用：tunnel 在 850 ms/帧的模拟器上运行，录屏约 2.6 fps，**动效流畅度不能从这些证据判断**。
- **挖孔检查排除全窗口 scrim**：合理而且范围窄。只排除宽和高都 ≥ 显示尺寸的节点，任何真实控件都不会这么大。覆盖缺口：只测了 `ROTATION_90`（挖孔在一侧），没有测 270；只检查带 text 或 contentDescription 的节点，不检查无标签的装饰图形。截图上横屏内容集中在右侧，挖孔一侧只有天空。

## 5. 设计评审（看原始图和视频）

视觉（看图）：
- 首页层级非常干净：大号状态词 + 一行原因 + 单个主胶囊 + 线路选择 + 齿轮/Details 胶囊，全部在下 1/3，单手可达。主操作的颜色语义清楚：未连接时 Connect 是橙色实心，连接中 Cancel 胶囊带进度填充，已连接时 Disconnect 是暗色并带计时，失败时 Retry 是橙色。
- 天空叙事（夜 → 日出 → 日落余烬）与状态一致，亮度排序可以量化。但**连接中与已连接的天空几乎一样**，部分可用的天空也只是略暗，区分主要靠文字和琥珀色小圆点。
- 登录页克制，玻璃卡片放在底部；200% 字号下标题换行与月亮的光晕有轻微重叠，但可读。横屏键盘态下输入框在键盘之上，排版正常。
- 玻璃：软件 GPU 测得条纹剩余 0.2%（平台模糊 0.3%），边缘锐度 22%。看上去是磨砂暗玻璃，比较克制，偏 Material 风格，没有液态的折射或高光感。真机 GPU 未验证。
- 浅色和深色系统主题下应用都是同一套深色场景（主题报告两者都是 26.1），属于有意的品牌一致。

源码推论：
- `CATALOG_UNAVAILABLE` 一律映射成 “Home exit unavailable”（TonoVpnService.kt:705）。但控制面在托管服务器目录不可用、身份签发失败时也返回这个码（services/control-plane/src/catalog.ts:164/311），所以失败原因有时会把用户引向错误的地方。属于 D1 的 minor。
- 读屏顺序在部分可用时读出 “Disconnect, Connected for 23:00 … (Partly working)”，“Connected” 这个词与状态冲突（ui `screen-reader-order.txt`，夹具）。a11y 报告里有 “ConnectConnect” 这样的拼接，可能意味着重复朗读，TalkBack 实际朗读未验证。
- 与“最新桌面品牌一致”：只有源码注释提到与桌面托盘使用同一字形家族，我没有比对桌面端，不计入证实。

## 6. 逐维理由（扣分点）

- D1 17.5：层级和减字都是一流。扣分：失败原因映射不准；“Engine stopped” 偏工程术语。
- D2 17.5：单手可达、consent 先解释、转屏和键盘下状态保持、所有入口回到 MainActivity，都有执行证据。扣分：真实账号流程未验证；s1 磁贴在紧凑面板上看不到副标题（环境因素，但用户也会遇到紧凑 QS）。
- D3 12.5：日出和海面的叙事有辨识度，暖橙色点缀克制。扣分：与桌面品牌的一致性未核实；天空在几个状态间区分度不够。
- D4 11：模糊做得实在、可度量。扣分：只是磨砂而不是 Liquid 材质；只在软件 GPU 上验证，没有真机。
- D5 11.5：天空跟随状态，可量化，并且尊重 Remove animations（a5：0.16% 对 0%）。扣分：连接中与已连接的视觉差小；流畅度无从判断（约 2.6 fps）；u8 的 “60fps” 是 Compose 测试时钟，不是实际帧率（文件里已注明）。
- D6 8.5：200% 字号（真实应用）、≥48 dp、ATF、读屏顺序、键盘焦点、中文、小屏、横屏都有。扣分：TalkBack 实际朗读未验证；“Connected for” 冲突；挖孔只测了一个方向。
- D7 3.5：真实隧道（本地替身）、出口日志分流核对、故障注入、真实 MainActivity 映射都很扎实。扣分：§3 残余是确定存在的状态缺口；system shard 有 FLAKY；没有真机、真实账号和真实服务；性能只有模拟器数据（冷启动 1.4–1.9 s，PSS 53 MB，测试 APK 65 MB）。

## 7. 未验证（不计入证实）

真机（GPU 玻璃、实时动效、触感、电量）；Tono 真实账号和服务；TalkBack 实际朗读；应用关闭期间引擎死亡（§3，只有源码推论和旧 run 的事实）；横屏 270°；动画开启条件下的引擎死亡宽限。

## 8. 证据文件

完整清单和 SHA256 见 `pr1673-r7-evidence-manifest.txt`。评审者拼的对照图在 `pr1673-r7-sheets/`。
