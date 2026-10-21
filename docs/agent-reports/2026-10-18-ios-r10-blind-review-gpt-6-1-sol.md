# PR #1672 第 10 轮独立盲审

审计日期：2026-10-18，America/Los_Angeles。仓库：raydocs/tono。

**结论：86.0 / 100；未达到用户目标 95；不通过原 rubric。真实性性能 3.0 / 5 低于单项 70% 底线；同时存在源码可确定的严重状态误导路径，触发否决。** 否决针对“运行图已停止而外部状态重新变成 Connected”，不是把模拟器 fixture 误认为真机事故。没有做真机复现。

## 1. 盲审边界与固定对象

- 固定源码：[90822de32f2cad955237b3549e0482369c537eaa](https://github.com/raydocs/tono/commit/90822de32f2cad955237b3549e0482369c537eaa)。所有源码判断、行号均来自这个树，不来自当前工作区 HEAD。
- PR tip：[16e9b2b2cfb110f59a92478be25d4662876226f9](https://github.com/raydocs/tono/commit/16e9b2b2cfb110f59a92478be25d4662876226f9)。`git diff --name-status <fixed> <tip>` 只输出 `M docs/changelog.d/2026-10-17-ios-singbox-horizon.md`；没有读取这个 changelog 的评分或解释。
- [iOS CI 39160461314](https://github.com/raydocs/tono/actions/runs/39160461314)、[ci-gate 39160465005](https://github.com/raydocs/tono/actions/runs/39160465005) 的 API `head_sha` 都是固定源码，结论都是 success。iOS job 的 checkout 日志另外核对到同一 SHA。
- 唯一读取的 PR 正文内容是下方 `## Rubric (verbatim, unchanged)` 节：API `.body` 直接交给提取器，只输出、保存该节，遇下一个二级标题停止。没有阅读正文其他评分段、PR 评论、其他评审线程、`docs/agent-reports` 或实施方密封自评，也没有联系实施线程。rubric 自带的报告路径只是原文引用，没有访问。
- 本轮由当前审计会话完成；没有新建线程，没有交给另一个 reviewer，没有调用 oracle，没有依赖以前轮次的分数。
- 只读产品与 GitHub。报告和证据保存在 `.amp/in/artifacts/pr1672-round10/`，没有产品修改、commit、push、评论、审批、合并、部署或 workflow dispatch。

## 2. Rubric 原样提取

以下内容与单独保存的 `rubric-verbatim.md` 相同，不增删评分规则：

## Rubric (verbatim, unchanged)

"统一100分：信息层级减字20、交互连贯单手20、高级克制及最新桌面品牌一致15、Liquid Glass材质15、状态动效15、可访问性适配10、真实性性能5；>=85且各项>=70%，严重状态误导/主操作难发现/不可读一票否决。"
- In English: one 100-point scale. Hierarchy and few words 20, coherent one-handed interaction 20, restrained quality consistent with the latest desktop brand 15, Liquid Glass material 15, state motion 15, accessibility 10, authenticity and performance 5.
- Pass: ≥ 85 and every item ≥ 70%. Veto: a serious state misrepresentation, a hard-to-find primary action, or unreadable text.
- The same text is quoted at `docs/agent-reports/2026-10-18-mobile-opus-5-5.md` line 10.

## 3. 七维评分与底线

这是本轮独立的判断分，不是 CI 分数，也没有为达到 95 调整权重或垫分。

| 原维度 | 本轮分数 | 占本项 | 70% 最低分 | 判定与依据 |
|---|---:|---:|---:|---|
| 信息层级减字 | 18.5 / 20 | 92.5% | 14 | 默认中英文 Home 都能按状态→短说明→主操作→线路→次操作阅读；路由说明下沉 Details，设置折叠解释。最大字版说明很长，Details 首屏被故障原因占满，需要滚动，但未将滚动外内容直接判为裁切缺陷。 |
| 交互连贯单手 | 17.0 / 20 | 85.0% | 14 | 实际 XCTest 有点击、输入、下滑关闭、切线、失败后重试、跨 App 返回；模式拒绝在 Details 和 Home 可见。失联确认与恢复写入仍有状态契约缺口；AX5 底部入口需要滚动，未证实其真实手持可达性。 |
| 高级克制及最新桌面品牌一致 | 13.5 / 15 | 90.0% | 10.5 | 海平面、日月、暖色主胶囊、烟色次层级与固定树中桌面 Sea 组件一致；不是因为旧 `TonoBrand` 仍有紫色就判品牌不一致。手机反射为明显横条，细节成熟度仍有空间；没有本 run 的桌面实渲并排图，不能声称像素一致。 |
| Liquid Glass 材质 | 13.0 / 15 | 86.7% | 10.5 | 原图有被背景着色的胶囊、轮廓高光和层次；源码实际使用 iOS 26 `.glassEffect`，内容卡不再层层玻璃。Reduce Transparency / Increase Contrast 有不透明回退，设置滚动边缘有实图。背景与手指连续交互、其他 iOS 版本只得到有限证据。 |
| 状态动效 | 13.5 / 15 | 90.0% | 10.5 | 中英文循环可见连接、部分可用、重连、断开和失败；重连计时延续、主按钮对应 Cancel，不重新演完整首次连接；Reduce Motion 海面静止。循环与 sheet-zoom 是脚本状态，不能冒充用户操作或真机帧率。 |
| 可访问性适配 | 7.5 / 10 | 75.0% | 7 | 可见 AX5 换行、布局堆叠、主操作保持可读；CI 核对 label、hittable 和大小。Apple audit 经过自定义过滤、像素重判，不能说原生零问题；AX5 widget 图主要拍到说明文字，没有拍全卡片。VoiceOver 听读顺序、焦点与公告未实听。 |
| 真实性性能 | 3.0 / 5 | 60.0% | 3.5 | 是真实编译的 SwiftUI/App Extension 在系统模拟器执行，不是静态概念稿；有系统 widget 放置和 ActivityKit。所有连接/探针来自 fixture，无真实隧道、触感、120Hz/GPU/能耗证据；性能采样未设验收阈值。恢复失败后外部状态的源码缺陷进一步限制可信度。 |
| **合计** | **86.0 / 100** | | | **总分虽 ≥85，但单项底线失败，且有否决项；不通过。距 95 为 9.0 分。** |

不把所有未验证能力都记为失败：真机、听读、触感与高刷是证据不足，而不是“已经坏了”。但这些也不能按已证实能力给满分。

## 4. CI、artifact 与 placed 断言独立核对

### 已执行证据：UI 是 25/25，不是零测试绿灯

`raw/ui-tests.log` 独立计数：25 个 started、25 个 passed、25 个不同测试名，未找到 skipped / XCTSkip / Skipping test 执行记录。三个 suite 汇总是同一次执行的重复汇总，不算成 75 个测试：

```text
Executed 25 tests, with 0 failures (0 unexpected) in 802.266 (802.293) seconds
```

测试名称与耗时逐项保存于 `verification-receipt.json`。原始日志第 2959–2963 行是汇总；第 25–2957 行覆盖各测试。Linux 和 macOS TonoKit 各执行 66 tests / 0 failures；`RouteApplyTests` 各 5 个。Linux sing-box 原始日志有四张配置图 `check ok` 与 `route ok`，分别 13、11、11、13 个 expectations。这是 CLI/fixture 路由图执行，不是真机 Network Extension 流量验收。

iOS 的两个 job 及步骤都是 success。ci-gate 另有 **17 success、3 skipped**（macos / sing_box / connect_bench）；因此“零跳过”只适用于上述 25 个 UI 测试，不能扩写为整个 gate 无跳过。固定 workflow 明说 iOS 暂不属于 ci-gate，iOS 资格由指定独立 iOS run 提供。

Xcode 日志实际有 Release device unsigned `BUILD SUCCEEDED`、Debug simulator `BUILD SUCCEEDED`。运行环境为 GitHub hosted macos-26、Xcode 26.6 / SDK 26.5、iPhone 17 Pro Simulator / iOS 26.5。未签名设备构建通过不等于安装实机通过。

### 已执行 + 视觉：小组件确实放到系统主屏

固定源码 `apps/ios/UITests/TonoUITests.swift:201–238`，尤其 `232–233` 的 placed 谓词与 `237` 的 `XCTAssertTrue(placed, ...)`，不是仅打印 boolean。该 test 是本轮 25 个通过项之一。日志第 2954 行：

```text
REAL-WIDGET gallery-lists-tono=yes gallery-text-exposed=no placed-and-read=yes
```

原图 `real-widget-gallery.png` 的系统卡片显示 Tono status；`real-widget-home-screen.png` 左上确有 Tono widget，读作 “Status unavailable / Open Tono to see the status”。视频末段约 819–825 s 也有从系统库添加到主屏的过程。图库 `gallery-text-exposed=no` 只是 gallery 的文字未暴露给 AX；不能据此否认最终放置，最终 AX 断言和图像相互支持。

这个断言只用 `label CONTAINS 'Status unavailable'` 定位，不校验 widget bundle identity；若同时存在同词第三方控件，它本身不够强。不过本 run 的最终原图明确显示 Tono 名称与图案，弥补了该归因限制。它证明“真实 widget host + unavailable 分支”，不证明真实 connected/degraded、锁屏 widget 放置或 Control Center control 已安装并操作。

### Artifact 字节完整性

- Artifact：12150076988，`ios-preview-screenshots`，82 个文件，其中 **70 PNG、5 MP4**，其余为日志、构建来源与采样。
- 下载 ZIP 580064492 bytes，SHA-256 与 GitHub metadata digest 一致：`5c393b4d468bb455357456f77979c0d9c0f1ee186f67e7e00029d4b8882b334a`。
- 保留未经修改的 ZIP 与解出的所有原始文件。99 个固定源码文件逐一用 `git hash-object` 对照固定树 blob，全部一致，见 `source-file-hashes.tsv`。
- `evidence-inventory.tsv` 是证据文件名、大小、SHA-256 与类型清单，不包含清单自身与 `SHA256SUMS`，以避免递归校验；`SHA256SUMS` 包含报告、清单和全部保留证据的校验值，仅不包含自身。

## 5. 路由 desired/applied 与失败恢复核查

### R10-F1：严重，触发“严重状态误导”否决——无运行图仍被 heartbeat 写成 Connected

**级别：源码确认的可达状态路径；本 run 没有在真实 PacketTunnel 上执行这个失败链。** 这不是原图中已发生的事故。

固定源码链：

1. `PacketTunnel/PacketTunnelProvider.swift:184–192` 在进入 `startOrReloadService` 前把 `graphRunning=false`。新图启动失败后，`197–224` 尝试恢复旧图；恢复也失败时返回 `.refused(..., running: nil)`，不在这里取消 tunnel。
2. App `App/Model/AppModel.swift:388–395` 收到 nil 时设 `routesStopped=true`；`ConnectionState.derive` 正确给 `.failed / ROUTES_STOPPED`，可发布 failed snapshot。这部分设计是正确的。
3. 但 provider `PacketTunnelProvider.swift:63–65` 的 5 分钟 heartbeat 固定调用 `writeStatus(running: true)`，没有读 `graphRunning`。`71–75` 随后把 `failure` 固定成 nil。
4. `TonoKit/Sources/TonoKit/StatusSnapshot.swift:69–84` 的 `fromTunnel(running:true, previous:failed, ...)` 不保留 failed：保留条件只接受 `previous.state.tunnelUp`，最后走 `.on`。
5. `StatusStore.save` 的状态不同会真正写入并 reload；`WidgetUI/StatusPresentation.swift:45–60` 将 fresh `.on` 标成 Connected，计时重新作为 live。此后 heartbeat 持续刷新，使它也不会自然变 stale。

因此：**图未恢复 → App 可正确显示 Routes stopped → 用户离开 App → 下次 heartbeat 将系统 widget/control 的共享状态重写为 fresh Connected。** 没有任何恢复成功确认。UI preview 中的 `stopped` 注入不启动真实 provider/heartbeat，不能覆盖这条链；本 run 的真实 widget 只有 unavailable，也覆盖不到。

最小修正方向（本轮不改代码）：heartbeat 的事实必须来自“当前是否有运行图”，恢复失败必须立即向共享状态传播明确故障，不能将 provider 进程仍在等同于路由运行。回归需要把 failed snapshot 跨 heartbeat 保持失败，并验证 widget 的可见标题，而不仅是 App phase。

### R10-F2：未确认不等于旧图已确认——NO_REPLY 仍给出确定路由答案

**级别：源码契约缺口；实际系统消息丢失/延迟的发生条件未在本轮复现，不作为独立真机事故陈述。**

`RouteApply.swift:85–88` 将没有/无法解码的回复统一为 `.notApplied(code:"NO_REPLY", inEffect:previous)`，且只恢复文件，没有询问运行图。`TunnelController.send:112–120` 混合了未发送/发送抛错/回调无 Data，调用方无法区分“根本没送达”与“请求已到但确认不可得”。前者保留 previous 合理，后者不能从无回复推导运行图仍是 previous。

若扩展已经切到新图而确认不可得，恢复旧文件不会回滚内存运行图；界面仍可能说 “Still using Three-tier”、给 example.com 的 Direct 答案，实际却是 Stable/Cloud。`readStatus` 有后续校正能力，是一个重要缓解，但不保证立即发生：`AppModel.swift:547` 在 pending 时跳过校正，且 finish 的失败分支没有主动发起状态查询。不能把“未来 foreground 或 NE 状态事件可能修复”当成当前答案准确。

已有 `testNoReplyFromTheTunnelIsNotSuccessAndRestoresTheFile` 的 reload mock 只返回 nil，没有模拟“实际图已变但无确认”。UI 的 send 注入同样只返回 nil，没有实际运行图。建议将不确定状态与已知旧图分开，并在重获 extension status 前避免确定式 route answer。此项与 F1 一起说明 desired/applied 分离尚未端到端闭合，但最终否决不依赖这个消息时序假设。

### R10-F3：恢复写失败被吞掉，下一次 On Demand 可使用被拒绝的选择

**级别：源码确认的故障组合；未做真实文件系统故障注入。**

`RouteApply.swift:79,83,87` 都用 `try? save(...)`。可构造的序列：首次 `save(requested)` 成功 → reload 拒绝并确认仍跑 previous → 第二次写 previous 失败。函数仍只报告旧图，磁盘却保留 requested。下次 On Demand 启动 `startService(reloadInputs:true)` 将读这个 requested，用户已经见到“切换失败”的请求在后续重启中生效。原子写只保障“某次失败没有半文件”，不保障第二次写一定成功。

当前五个 RouteApply tests 没有 second-write-fails case；preview 的 save 故障只会让第一写直接失败。需要保留/呈现持久化恢复失败，不能把原子写当作整个事务原子性。

### 正向确认与证据覆盖矩阵

| 场景 | 固定源码判断 | 本 run 的实际执行/视觉覆盖 |
|---|---|---|
| 第一次 save 拒绝 | 不 reload，保留 previous；正确 | TonoKit 单测通过；没有实际 App Group 写故障画面 |
| send 无回复 | 不认作成功，但错误地把 previous 当已确认事实；见 F2 | TonoKit nil mock；没有真实 send 故障实验 |
| reload 拒绝、旧图仍在/恢复成功 | 返回 running previous，旧选中项、答案和拒绝说明一致；正确 | UI `testRefusedModeSwitch...` 通过；原图和 591.5–600.5 s 画面支持；provider 是 mock 回复 |
| reload 拒绝、恢复失败、running=nil | App Routes stopped / 不再输出当前站点路由答案；正确局部状态 | TonoKit nil-running + ConnectionFacts 测试；routes-stopped 中英文静态 fixture；没有真实 core 双失败或 heartbeat 验证 |
| 恢复写文件失败 | 忽略，运行与后续启动配置分裂；见 F3 | 未覆盖 |
| 明确 applied requested | 确认后更新 mode，重算当前查询；正确 | TonoKit 单测；UI 切 Stable 后 example.com 从 Direct 改 Cloud，UDP Blocked；画面约 618.5–621.5 s |

## 6. 审计后恢复字号复测：是否掩盖问题，是否本 run 触发

### 新分支本 run 没有触发，因此没有将低于 4.5 的记录“洗绿”

独立搜索完整 `raw/ui-tests.log`：

```text
FAILS WCAG AA: 0
after the audit:: 0
off screen; measured after scrolling: 1
SWEEP calls: 11; checked texts/controls: 121; reported failures: 0
```

35 条 contrast 类 AUDIT 日志含 1 条离屏复测的重复记录，即 34 个打印出来的 contrast 标记；不是 35 个不同缺陷。22 个无归属标记由 11 次 sweep 接管。可归属测量记录为 6.3:1 至 16.6:1 等。唯一离屏案例是 largest-text-onboarding 的 “Everything else → your own network”，第 1737 行先记录离屏，第 1754 行滚动后测得 **16.5:1 PASSES**；它不是新增的低分 settle 分支。

另外有 **17 个 Dynamic Type、7 个 textClipped** 标记：17+5 个属于 fixed-size widget 过滤，另 2 个是 AX5 primer 的“更大字号可能裁切”预测。总计 59 条 AUDIT 日志含上述一次重复。故准确表述是“25 测试在自定义接受规则下通过”，不是“Apple 原生审计没有报任何问题”。

### 方法保留 4.5 阈值，但不能无条件接受“都是坐标错位”的解释

- `TonoUITests.swift:563–572,606–612` 保留回调低分日志，将同一个元素放入 settle；audit 结束后 sleep 1 秒重测，缺失/不可见结果按 0 失败。它没有降低 4.5 阈值，也没有把重测失败静默丢弃。
- 但“1 秒过去”和“窗口包含 element.frame”并没有证明之前的截图确实读错坐标。若低对比只发生在真实可选的大字号布局或转换期间，恢复原字号后读到正常布局就会把真实问题放过。应该保留回调截图与字号/布局身份，必要时在被标记字号单独重启测量。本 run 没触发，所以不能从本 run 证实其纠错理由，也不能说它已遮住某个低分。
- 即使不触发 settle，`measuredContrast` 的 median-background + 极端 3% luminance 也只是元素整体的启发式，不是每段字与局部背景的 WCAG 证明。一个高亮图标/边框可以让淡文字所在元素通过。独立数值反例：85% RGB20 背景、11% RGB70 标签、4% 白图标，等价计算给 **18.42:1 PASS**，但实际灰字/背景只有 **1.95:1 FAIL**。这只是算法数值反例，不是假称某张 App 原图测到了 1.95。
- AX5 widgets 原图主要是说明段落，未展示那些被过滤的卡片全貌；不能用该张图就关闭所有固定尺寸卡片裁切疑点。默认大小的卡片可读，不能代替最大卡片字号取证。

**方法判定：没有本 run 洗绿的证据；有真实的漏判能力与证据缺口。不给审计“无条件全 AA”背书，也不因未触发的风险硬判本 run 存在不可读 veto。**

## 7. 视觉、交互、动效与桌面一致性的观察

### 视觉（不是隧道执行）

70 张原 PNG 均列入清单并通过 9 张带文件名 contact sheet 通看，关键图另外打开原分辨率：mode-refused、真实 Home Screen widget、AX5 connected、AX5 details。默认中英文状态、空/加载列表、权限 primer、onboarding、系统浅色、widget 浅色底、Increase Contrast、Reduce Transparency 都在本 run 原图中。

主按钮位置、文字与对比没有发现“主操作难发现”或稳定状态“不可读”否决。AX5 connected 的底部 Details 在截图下边缘，需要滚动；源码 `BottomScroll` 提供滚动，不能仅凭静图边界宣布内容永久丢失。但没有真实 VoiceOver/单手完成这条 AX5 路径的证据。

真实 widget unavailable 图与 fixture gallery 必须分开：后者逐卡带 Preview，不是已装系统小组件的 connected 实况；Dynamic Island 原图是系统 ActivityKit host，但内容也明确 Preview。

### 实际执行（仍然是 fixture）

UI 视频原始时间约 585.5 s 显示站点输入键盘，588.5 s 键盘已关且答案在屏内；591.5–594.5 s 保留 Three-tier 并显示拒绝说明，597.5–600.5 s Home 仍可见拒绝；618.5→621.5 s 从直接路由答案变为 Stable/Cloud；672.5 s 非站点查询有明确错误句；687.5 s 设置内容经过导航条边缘；约 764–774 s 包含开始连接、打开 sheet、切后台再回来；819–825 s 有真实系统 widget 放置。

上述与测试的 hittable / window.contains / 键盘消失断言相互支持。`typeText` 的编辑测试画面还出现了 `orgexample.com`（约 657.5 s），并非真的成功把 example.com 改成 example.org；它确实证明“输入发生变化后旧答案消失”，不证明光标末尾替换体验。

### 动效（不是 120Hz 验证）

四个短视频总览与原始取帧支持：首次连接有上升与进度，已连↔部分可用↔网络重连保留时钟，断开到月夜，失败给 Retry；Reduce Motion 持续海面与扫光减少，字号变化期间的滚动外内容不误算作持续视觉错误。`sheet-zoom` 由 preview 自开自关，没有用户点击，所以只给表面转场证据；真实 sheet 交互另看 UI-tests。

原始视频过大导致直接媒体上传超时；没有反复硬重试。保留所有原 MP4，以 ffmpeg 制作时间不变的低分辨率代理观察；长视频两个代理片段读取失败的区域改看原 MP4 定时取帧并与原始日志交叉核对。代理是 20fps（短片）或 12fps（UI 分段），不用于宣称流畅性阈值。原 MP4 的 `r_frame_rate=600/1` 是容器报告值，不是 600fps 实测，更不是 120Hz 真机证明。

桌面参考只读取固定树的 `SeaHomePillStyle.swift`、`SeaControls.swift`、`SeaSceneParameters.swift` 与 `Theme/TonoTheme.swift`，保存在 `desktop-reference.tar.gz`。前两者支持暖色主操作、smoked 次操作和 opacity/Reduce Motion 处理，海平面参数支持共享视觉语言；没有借用别的审查结论。

## 8. 性能与未验证项目

`perf.txt` 是 Mac 上模拟器进程采样：connected-live CPU 3.8–8.3%、RSS 209488–210288 KB；Reduce Motion CPU 0.1–0.3%、RSS 196800–203264 KB。只能支持同一 runner 上静态路径较轻，不是电池或 iPhone 负载。

XCTest metric 平均 Memory Physical 59917.248 kB、Memory Peak 63183.125 kB、CPU Time 6.627 s。CPU Instructions/Cycles 为 0，日志还有 “Unable to reset the peak interval footprint” 提示；不将零读数算作高效。测试没有性能 baseline/门限，且包含启动与 sleep。两种内存数字的采集方法不同，不混同也不择小值作为唯一内存结论。源码海面约 30Hz Timeline 也不是主 UI 120Hz 性能证据。

**没有验证：**真机签名安装/Network Extension 权限/真实账号登录、真实 VPN 隧道与 fail-closed、真实 send/reload/双恢复失败、On Demand 重启回放、VoiceOver 听读和焦点顺序/公告抢占、触感、120Hz 帧时间/GPU/热/能耗、系统 Control Center control 实际操作、锁屏 widget 放置、旧 iOS 材质回退、小屏/横屏/所有语言。

本 orb 是 Linux，没有 Swift/Xcode；未安装工具链、未本地重跑原生测试。本轮执行的是证据下载、哈希校验、日志计数、媒体解码/取帧、固定源码 blob 比对及审计算法数值反例。没有把这些包装成新增的产品运行测试。

## 9. 否决与后续所需证据

- **严重状态误导：触发。** F1 提供具体源码链：恢复失败无图 → heartbeat 无条件 running=true → shared status fresh on → widget Connected。尚未有实机事故复现，不影响这条源码状态机缺陷成立。
- **主操作难发现：不触发。** 默认与 AX5 原图主按钮可辨认；CI 有可点击/低位入口证据。
- **不可读：本轮未触发。** 默认和关键 AX5 内容可读；未把自定义 audit 的绿灯扩大为全面无障碍通过，也未把未滚到的内容直接判为不可读。
- **70% 单项底线：真实性性能不通过（3.0 < 3.5）。** 总分 ≥85 不能覆盖这条规则，95 目标也没有达成。

如果继续，优先关闭 F1，并让同一真实 provider/shared-state 路径的失败与恢复验证覆盖 heartbeat；F2/F3 要分清“未确认”“明确仍在用旧图”“持久化恢复失败”。补充 AX5 卡片滚动取证、真实 VoiceOver/设备行为与性能数据后再评分，而不是只增加静态图或换一套 audit 解释。本轮不实施修正、不发 GitHub。

## 10. 文件位置与复核入口

全部位于 `/home/user/workspace/repo/.amp/in/artifacts/pr1672-round10/`：

- `report.md`：本完整报告。
- `rubric-verbatim.md`：只提取的原样 rubric 节。
- `evidence-inventory.tsv`：全量文件证据清单（路径、大小、SHA-256、类别）。
- `SHA256SUMS`：报告与全部保留证据的 SHA-256 清单；自身校验值在最终回复给出，避免递归自校验。
- `verification-receipt.json`：25 项测试名/耗时、skip/复测计数、widget 回执、视频元数据、数值反例。
- `audit-flags.txt`：本 run 全部打印的 AUDIT/SWEEP 行，无其他评审内容。
- `artifact-12150076988.zip`、`raw/`：原始 ZIP 与全部 82 个原始文件（70 PNG、5 MP4）。
- `ios-run.json`、`gate-run.json`、`ios-jobs.json`、`gate-jobs.json`、`artifact-metadata.json`、`ios-logs.zip`、`gate-logs.zip`：只读 API 元数据与原 Actions 日志。
- `source/`、`fixed-source.tar.gz`、`source-file-hashes.tsv`：固定源码快照、压缩包及 99 个逐文件 blob/字节校验值。
- `desktop-reference.tar.gz`：固定树的四个桌面参考源码文件。
- `tip-delta.txt`：fixed→tip 仅 changelog 的 name-status 输出。
- `review-media/`：9 张原 PNG 的 contact sheets、长视频两个区段定时取帧 contact sheets、短片/分段代理；都是原始证据的派生观察辅助，不替换原始 hash。

报告与证据清单的确切 SHA-256 在最终交付消息中给出。没有将任何其他评审的文件、分数或内容纳入这套证据。
