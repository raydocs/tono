# Tono iOS 独立盲审 — Round 1 / 最多 2 轮

- 冻结候选：`a20b3c1074434a938d6c04da5b43b1f4c5ff3ad7`。
- 首条检查 `git rev-parse HEAD` 的原始输出：`a20b3c1074434a938d6c04da5b43b1f4c5ff3ad7`，完全一致。结束前再次核验一致；`git diff --exit-code HEAD -- apps/ios .github/workflows/ios-ci.yml` 无输出，`git status --short --untracked-files=no` 无输出。
- 依据仅限本轮 BRIEF、其中指定的冻结源码和原始 evidence。没有读取历史报告、自评、PR、父会话状态或其他评审输出；没有联络其他评审/实现者，没有额外代理。
- 原始采集结论为 **BLOCKED**，不是通过。`capture-results.csv` 的 72 个矩阵行是 **57 captured_verified + 15 skipped**。本报告是有限覆盖盲评分，不把采集缺口算作 UI 失败，也不补猜缺失场景。
- 证据目录简称 **E**：`/Users/ruirui/.local/state/devin-cloud/runs/20261019-224452-wait-3c14bd1f7/attachments/`；源码路径均相对隔离 checkout。
- 标记：**观察**＝本评审直接打开的截图/接触表；**源码推断**＝静态追踪得到、没有运行复现；**云端已执行**＝原始日志证明 Devin 执行，本评审未重跑。

## 1. D1–D7 评分、70% 下限与依据

保持原 rubric：信息层级减字 20、交互连贯单手 20、高级克制及最新桌面品牌一致 15、Liquid Glass 材质 15、状态动效 15、可访问性适配 10、真实性性能 5。总分须 ≥85，且每项 ≥70%；严重状态误导、主操作难发现、不可读为一票否决。

| 项目 | 得分 / 权重 | 70% 下限 | 判断与已见证据（均在 E） |
|---|---:|---:|---|
| D1 信息层级、减字 | **17 / 20** | 14 | Home 状态→原因→主按钮→线路的顺序清楚，失败原因短句与 Details 分层有效；空列表与加载态不是空白。Settings 重复解释模式入口，Details 的标题/分区留白把实际流量去向推到首屏以下，AX5 下更明显。`ios-en-P-default-home-idle.png`、`ios-en-P-default-home-degraded.png`、`ios-en-P-default-details.png`、`ios-en-S-default-details.png`、`ios-en-P-default-lines-empty.png`、`ios-en-P-default-lines-loading.png`、`ios-en-P-AX5-settings.png`。 |
| D2 交互连贯、单手 | **16 / 20** | 14 | 主按钮、线路、Settings、Details 都在底部，Connect/Cancel/Retry 语义明显；线路切换等待中不先换城市，未确认模式不假选中。云端 fixture 日志有关闭 sheet、选线、取消、重试通过记录。但真实启动在系统配置 await 之后可越过 Cancel，见 F3；不能用 fixture 的取消通过抵消。`ios-en-S-default-home-connected.png`、`home-line-pending.png`、`details-mode-unconfirmed.png`、`ui-tests.log`；`AppModel.swift:291–312`、`TunnelController.swift:75–94`。 |
| D3 克制、品牌一致 | **13 / 15** | 10.5 | 夜海/暖日/单一暖色 CTA、同一日轮标记与细线图标在已见 app/Live Activity 间连贯；不是多卡片仪表盘。反射的长条堆叠仍略显程序化，密集描边也稍重。`ios-en-P-default-signin.png`、`ios-en-P-default-home-connected.png`、`ios-zh-P-default-home-degraded.png`、`ios-en-P-default-live-activity.png`。`tools/generate-ios-brand.py` 确实导入桌面图标生成器，但**没有获准的最新桌面对照图**，不据注释宣称已验证完整桌面一致性；此分仅评可观察的克制与同源设计。 |
| D4 Liquid Glass 材质 | **12 / 15** | 10.5 | Home 胶囊有上缘光、暖色反射、控制层与内容层区分；源码使用原生 iOS 26 `glassEffect`，不是仅声称用了玻璃。但深色烟层及描边使 sheet 和部分胶囊较接近实心深色药丸，光学层次仍可更轻。`ios-en-P-default-home-idle.png`、`ios-en-P-default-home-connected.png`、`ios-en-P-default-lines.png`、`ios-en-P-default-settings.png`；`Theme.swift:188–217`、`LinesSheet.swift:134–145`。不因缺失 widgets-light 扣分。 |
| D5 状态动效 | **13 / 15** | 10.5 | 两张接触表直接可见：初连日出、成功、部分可用、重连保留计时、断开、失败重试；重连不是重放首次启动。Reduce Motion 源码停掉环境漂移/扫光/摇动。减弱版接触表 17.750s 的状态标题正处在很暗的淡入/淡出阶段，状态字可更即时稳定，见 F6。`ios-motion-connect-cycle-frames.png`、`ios-motion-connect-cycle-reduced-frames.png`；`SeaScene.swift:17–25`、`HomeView.swift:465–484,593–601`。**仅设计/渲染层评价，不是实际流畅度、120 Hz 或产品验收。**缺失 sheet-cycle 不扣分、不猜测其质量。 |
| D6 可访问性、适配 | **9 / 10** | 7 | SE 的主操作可见；AX5 使用滚动、纵向排布和完整单词，已见状态/按钮没有不可读的持续截字。AX5 的长副文案与大分区标题增加滚动负担。主操作深色字在暖填充上可读。`ios-en-S-default-home-connected.png`、`ios-en-P-AX5-home-connected.png`、`ios-en-P-AX5-home-failed.png`、`ios-en-P-AX5-signin.png`、`ios-en-P-AX5-lines.png`、`ios-en-P-AX5-details.png`、`ios-en-P-AX5-settings.png`、`primary-label-connecting.png`。日志中的 accessibility audit 是带过滤/重新像素测量的测试，不等于未豁免的原生全审计，也不是人工 VoiceOver 通行证。 |
| D7 真实性、性能 | **2.5 / 5** | **3.5 — 未达标** | DEBUG 场景醒目标明 fixtures/no account/tunnel；未确认和 routes-stopped 的已见画面没有显示 Protected，规则查询明确写非实时测试。云端有可核对的 simulator 内存/CPU 样本。但 F1 的跨账户异步结果与 F2 的 catalog/运行图身份缺口，会使真实状态/路径可信性失效；扣分来自这些具体源码问题，不来自缺失真机或缺失场景。`ios-en-P-default-home-unconfirmed.png`、`ios-en-P-default-home-failed-routes-stopped.png`、`details-mode-unconfirmed.png`、`details-route-check.png`、`simulator-performance.txt`；下述 F1/F2。**性能分仅设计/模拟器层面，绝非 NE 或真机验收。** |

## 2. 一票否决（explicit veto list）

- **V1：严重的当前路由状态误导，源码推断，适用。** F2：同一 mode/node 的新 catalog 被直接用于描述旧的运行图；可把实际仍走 Cloud 的 AI 路径说成 Home broadband。相关界面文件：`ios-en-P-default-details.png`、`details-route-check.png`、`ios-en-P-default-home-connected.png`；这些截图只证明被影响的呈现方式，**没有复现 catalog 切换场景**。决定性依据是 `AppModel.swift:176–189,599–603,632–643` 与 `TunnelConfirmation.swift:9–16` / `RouteApply.swift:4–7` 的确认协议不含 catalog 身份。
- **主操作难发现：无。** 直接查看的 Home、SE 与 AX5 中，主操作均有明确按钮及动词。
- **不可读：无持续性否决。** AX5 底部内容需滚动，不把 ScrollView 的视口裁切当作永久截字；F6 是过渡期可读性的小问题，不升级为此 veto。
- 没有把未捕获场景、BLOCKED 字样本身或诊断中文 Live Activity 混语提升为 veto。F1 另属 major 安全阻断，不另造第四种 rubric veto。

## 3. 总分及结论

**17 + 16 + 13 + 12 + 13 + 9 + 2.5 = 82.5 / 100 — FAIL。**

总分低于 85，D7 低于 3.5 下限，且有源码推断的 V1。即使不采用 V1，总分/单项门槛仍未通过。本结论不是对 15 个未覆盖矩阵行的惩罚，也不是从“35 tests passed”反推设计分。

## 4. 按严重度及分数影响排序的 findings

### F1 — MAJOR / 安全：登出或换账户没有隔离在途 token/catalog 请求（源码推断，未执行复现）

- **位置：** `apps/ios/TonoKit/Sources/TonoKit/Account.swift:124–140,154–169`；调用落点 `apps/ios/App/Model/AppModel.swift:248–266,613–619`。`CachedCatalog` 不带账户归属，文件缓存是单个全局槽。
- **场景：** A 的 refresh 或 exit-catalog 在 `await` 中；A 登出清 token、随后清 cache。actor 在 await 时可重入：旧 refresh 返回后仍在 139 行保存 A 的 token；旧 catalog 返回后仍在 164 行重新写 A 的 cache，AppModel 也无会话代号检查就 `apply`。若随后登录 B 且 B 拉取失败，网络 fallback 可读到 A 的 catalog。即使不换 B，登出完成后旧结果仍可恢复本应删除的本地凭据/目录。
- **影响：** 违反 no cross-account mixing、stale app writes cannot revive state。这里证明的是本地隔离缺失；**没有证明登出后远端 A token/出口仍有效，也没有实际发出跨账户流量**。
- **相关画面：** `ios-en-P-default-settings.png` 是 Sign out 入口上下文，不是该竞态复现。
- **修复：** 在登出入口和账户切换时同步递增 account/session epoch；每个网络请求保存 epoch，所有 await 后、token/cache 写入前以及 AppModel.apply 前比对。缓存按服务端账户/安装会话归属隔离，fallback 必须同账户；取消旧任务只是辅助，不能代替写入门禁。增加受控延迟响应的登出/换账户回归，验证旧响应不能写回（本轮未运行）。
- **提升项：** D7；major 安全问题不能由 fixture 截图或 UI 通过记录覆盖。

### F2 — MAJOR / V1：确认的只有 mode/node，不是用于画面解释的那份 catalog（源码推断，未执行复现）

- **位置：** `apps/ios/App/Model/AppModel.swift:176–189,585–603,632–643`；`apps/ios/TonoKit/Sources/TonoKit/TunnelConfirmation.swift:9–16`；`apps/ios/TonoKit/Sources/TonoKit/RouteApply.swift:4–7`；`apps/ios/App/Views/DetailsSheet.swift:89–111`。extension 的 held inputs：`apps/ios/PacketTunnel/PacketTunnelProvider.swift:208–226`。
- **场景：** On Demand 的旧图 C1 正在运行；app 重新启动，先加载/询问 tunnel，再取得 C2。C1 没有 Home、AI 因而走 Cloud；C2 给同一个 cloud node 分配了 residential Home。`apply(C2)` 马上换掉 `catalog/homeKind`，但没有重建正在运行的 C1。TunnelAnswer 只含 session/generation、mode/node、时间，不能证明 C2 是当前图。Details 因而显示 Home broadband，`check("claude.ai")` 从 C2 建图回答 HOME，实际 C1 仍走 Cloud；旧图的成功 probe 也可以继续被贴到新 catalog 的 Home 名称上。
- **影响：** 不是简单的“配置可过期”：当前路由/出口类型被明确说错，跨越消费者依赖的住宅出口与云出口边界。现有 GraphStamp 防止旧 generation 的 probes 认证新 generation，但 catalog 更换根本不改变运行 generation，故没有补上此洞。
- **相关画面：** `ios-en-P-default-details.png`、`details-route-check.png`、`ios-en-P-default-home-connected.png`；仅为 UI 上下文，截图没有 C1→C2 的运行复现。
- **修复：** tunnel answer/report 携带运行图的 catalog+路由摘要/输入身份（或返回用于解释的已确认图描述），保留 admitted 与 running 两套快照。所有 Home/Lane/RouteCheck 只能读取与确认身份一致的 running 快照；更新目录先待应用/未确认，重建成功且新身份确认后再切换。补充同 mode/node、Home 赋值变化的回归。
- **提升项：** D7；解除严重状态误导 veto。不能仅把新 catalog 的 generation 在 app 中自增来“确认”。

### F3 — MAJOR / 交互生命周期：Cancel 可在保存 VPN 配置期间被已开始的启动覆盖（源码推断，未执行复现）

- **位置：** `apps/ios/App/Model/AppModel.swift:291–312`；`apps/ios/App/Services/TunnelController.swift:69–82,87–94`。
- **场景：** `connect()` 在 catalog 返回时检查一次 `wantOn`，随后进入 `start()`；`prepare()` 等待 `saveToPreferences/loadFromPreferences`。这期间 Cancel 把 `wantOn=false` 并执行 stop，但 `start()` 恢复后不再检查意图，直接调用 `startVPNTunnel()`。首次配置时 `manager` 可能尚未赋值，stop 甚至直接返回；已有配置也没有串行的 start/stop 门禁。
- **相关画面：** `primary-label-connecting.png` 的 Cancel 是明确可用的主操作；不是该真实 NE 竞态的复现。云端 `testCancelWhileConnecting` 只驱动 `previewToggle`，不经过这里。
- **修复：** 让 start/stop 共享单调 operation token 或串行 coordinator；每个配置 await 后和实际 start 前验证最新 intent，取消必须使仍在 prepare 的操作失效，必要时清理刚保存的 On Demand。对 controller 注入可暂停的配置保存/重载，验证取消后没有任何迟到 start 调用。
- **提升项：** D2、真实行为可信度；不是主按钮的视觉可发现性问题。

### F4 — MINOR / 信息效率：Settings 用一屏大字教用户去另一个入口，而非直接给简短选项（观察）

- **画面：** `ios-en-P-AX5-settings.png`：模式位置解释及 “What Tono can and cannot recognise” 占掉几乎整页；实际 VPN protection 控件在首屏下方。`ios-en-P-default-settings.png` 同样存在重复的模式位置教学。
- **位置：** `apps/ios/App/Views/SettingsView.swift:24–49`、`apps/ios/App/Views/Components.swift:165–173`。
- **修复：** 删除重复的入口说明，改为短的模式摘要/可直达的行；scope disclosure 用短标题，长解释留在展开内容。保留 AX5 原生缩放和滚动，不用缩字或限制 Dynamic Type 掩盖问题。
- **提升项：** D1，兼顾 D6 的任务效率。不是不可读 veto。

### F5 — MINOR / 材质：烟色层和描边压过玻璃光学层次（观察 + 源码定位）

- **画面：** `ios-en-P-default-lines.png`、`ios-en-P-default-settings.png` 的主体近似均匀深色面板；Home 两条胶囊有玻璃感，但硬描边较抢眼。不是“未使用原生 API”。
- **位置：** `apps/ios/App/Views/LinesSheet.swift:134–145`、`apps/ios/App/Views/Theme.swift:188–217`。
- **修复：** 小范围降低覆盖烟层/边缘强度，让背景暖光贡献更多层次；内容仍为实心/烟色内容卡，不能堆玻璃，也不能牺牲文字对比。Reduce Transparency 和 Increase Contrast 保留不透明分支。
- **提升项：** D4（以及视觉克制）；需以同场景复看，不建议全局加 blur。

### F6 — MINOR / 状态动效：Reduce Motion 下状态字仍短暂很暗（接触表观察，非连续播放结论）

- **画面：** `ios-motion-connect-cycle-reduced-frames.png` 的 17.750s，“Disconnecting” 处在明显低不透明度阶段；其他采样时刻的静态字清楚。
- **位置：** `apps/ios/App/Views/HomeView.swift:593–601`：reduceMotion 只去掉位移，仍保留先离开、延迟淡入的 opacity transition；`controls` 也有 phase animation。
- **修复：** Reduce Motion 下让状态标题/主动作立即替换或采用更短、无延迟的清晰替换；普通模式保留节制动效。用高密度过渡帧确认，不用这个单帧推断长时间闪烁。
- **提升项：** D5；不据此宣称设备掉帧，也不构成持续不可读 veto。

### 独立 source coverage checklist

下列“已检查”只表示静态覆盖，不是相应路径已运行通过。

| 生命周期/不变量 | 本轮独立覆盖与结论 |
|---|---|
| 启动、前台、权限、开始/取消/停止 | 已读 AppModel 的 onLaunch/onForeground/connect/disconnect 及 TunnelController；F3 未通过最新意图约束。 |
| 登录/登出、refresh、cache/fallback、持久化 | 已读 AccountSession、AppModel 账户落点、Storage；F1 未通过跨账户隔离。没有检查服务器实现，不推断服务器接受旧凭据。 |
| 同会话确认、旧 ticket、旧 generation、expiry、未知回复 | 已读 ConfirmationTracker、AppStatus、ConnectionState、ProviderReply；epoch/generation 与 silence/expiry 基本防线存在，reply timeout 只投递一次。F2 是另一层图身份缺口。 |
| Probe 与图绑定 | 已读 AppModel startProbes/startChecksIfNeeded/recompute 与 GraphStamp；取消/epoch/generation 门禁存在；无法识别 F2 的 catalog 更换。 |
| 模式/线路变更、拒绝、无答复、put-back | 已读 RouteApply、AppModel change/finish/adoptConfirmed/retryPutBack；已见 pending/unconfirmed/noGraph 呈现保守。没有执行故障注入。 |
| Extension 图 start/reload/restore/close、core-stop latch、heartbeat | 已读 PacketTunnelProvider、TunnelGraph、UnderlyingNetwork、TunnelPlatform 相关路径；检查 service/status/stop 锁与写入顺序。没有运行真实并发、jetsam 或 NE 回调，不宣称形式化 race-free。 |
| 跨进程 app/tunnel 写入、TTL、旧图拒收 | 已读 SharedStatus、StatusFile、StatusStore；app note 不直接续期 tunnel report、文件写有 flock/atomic。真实系统调度未验证。 |
| Widgets / Control / Live Activity 状态及动作 | 已读 StatusPresentation、StatusProvider、TunnelControl、TunnelCommand、SetTunnelIntent、LiveActivityController、ActivityPresentation/Live Activity widget；有 unknown/stale/noGraph 分支与开始门禁。完整 widgets 矩阵仍未覆盖。 |
| Fail-closed 路由及系统设置 | 检查 SingBoxConfig 的 protected TCP route、UDP/ICMP reject、fake-IP reject、final rule；TunnelInputs 二次 admission、CatalogAdmission 的 TLS/skip-cert-verify 拒绝片段、NE IPv4/IPv6/DNS、includeAllNetworks 默认及平台设置。未见直接把 protected failure 改为 DIRECT 的分支；**不是实际无泄漏证明**，也不是完整 YAML/JSON/密码学解析器审计。 |
| 构建/DEBUG 隔离 | 已读固定基线 diff 的 `.github/workflows/ios-ci.yml`（新文件 138 行）：固定 action/XcodeGen 引用、unsigned device/Debug sim 构建、Release preview 字符串检查、fixture UI/a11y。没有执行 workflow、验证上游 pin 下载或二进制产物，也不授予发布信任通过。 |

### 本轮实际做过的检查与原始回执

1. 本机仅执行只读 git/source/JSON/CSV/log 检查，以及直接打开图像；唯一写入为本报告。未做代码、测试、pin、rubric 或 SESSION_STATE 修改；没有提交、推送、安装、native build/test、新云会话。
2. 使用指定固定基线：
   `git diff 59082acfb52f31963b39e52595549875d0f01ed4...a20b3c1074434a938d6c04da5b43b1f4c5ff3ad7 -- apps/ios .github/workflows/ios-ci.yml`。
   该范围为 109 个新文件、14054 插入；通过分段 diff 与冻结源码定位上述路径。不是声称逐行审计全部资产/工具/解析器。
3. **直接打开 33 张原始图像**：25 个矩阵 PNG、2 张 connect-cycle 接触表、4 张 UI-test PNG（`details-mode-unconfirmed.png`、`home-line-pending.png`、`details-route-check.png`、`primary-label-connecting.png`），另有 English island whole-window supplemental 与 Chinese Live Activity diagnostic。评分表/各 finding 已逐项列出使用的文件；这是视觉抽样，不谎称逐张审阅了全部 57 个矩阵 PNG。
4. **云端已执行，本评审只读日志：** `ui-tests.log` / `ui-test-summary.txt` 原文：`Executed 35 tests, with 0 failures (0 unexpected) in 1018.129 (1018.157) seconds`，`** TEST EXECUTE SUCCEEDED **`。summary 也记录 DEBUG simulator build 与 build-for-testing 成功。没有本轮本机新执行的测试、red check 或竞态复现。
5. 读取测试源码确认边界：`UITests/TonoUITests.swift:15` 使用 `-TonoPreview`；sheet audit 使用 `-TonoLargeSheets`；audit 的 contrast 重测、AX5 clipping/fixed-widget 豁免见 854–895 行。35 通过不能证明 F1–F3，也不能抹去矩阵未覆盖项。
6. `simulator-performance.txt` 原文数据：peak physical memory 平均 **66137.664 kB**，physical memory **63690.987 kB**，CPU time **2.666 s**（3 个样本）；cycles/instructions 为 **0**、baseline 为空。它们是 fixture app 的 simulator 样本，**不是 extension 内存、真实 CPU 零开销、帧率、耗电、带宽或延迟验收**。

## 5. 证据限制与真机检查清单

### EVIDENCE NOT COVERED（owner-approved gaps；不因缺席扣分，不猜测通过）

以下矩阵变体全部 **NOT COVERED / 未评分该场景**，即使 UI tests 通过了另带 fixture 入口的类似流程，也不冒充这些确切参数的矩阵图：

- **Onboarding：** `ios-en-P-default-onboarding.png`、`ios-zh-P-default-onboarding.png`、`ios-en-S-default-onboarding.png`、`ios-en-P-AX5-onboarding.png`。
- **VPN primer：** `ios-en-P-default-vpn-primer.png`、`ios-zh-P-default-vpn-primer.png`。
- **Connected-offline：** `ios-en-P-default-home-connected-offline.png`、`ios-zh-P-default-home-connected-offline.png`，没有独立渲染状态；不能把 connected 图当作该行为证据。
- **Widgets：** `ios-en-P-default-widgets.png`、`ios-zh-P-default-widgets.png`；standalone launch 未取得目标 gallery。现有测试中的真 widget/unavailable 截图不替代完整状态矩阵，本轮没有给未见 gallery 状态加分。
- **Widgets light：** `ios-en-P-default-widgets-light.png`、`ios-zh-P-default-widgets-light.png`。
- **Widgets routes：** `ios-en-P-default-widgets-routes.png`、`ios-zh-P-default-widgets-routes.png`。
- **Chinese Live Activity 完整矩阵行：** `ios-zh-P-default-live-activity.png`。直接打开的是 `diagnostic-ios-zh-P-default-live-activity-lock.png`，只见 English Connected/Preview 与中文 东京；app 的语言 launch 参数不等于 extension/system 的语言配置，不据此断言产品翻译坏了，也不当作完整成功矩阵行。
- **Sheet-cycle：** `ios-motion-sheet-cycle.mp4`、`ios-motion-sheet-cycle-frames.png` 均无。不能借 connect-cycle 推断 sheet 打开/关闭的运动连续性。
- English `ios-en-P-default-live-activity.png` 是原生 simctl Lock Screen 图，可能不含 Dynamic Island；已直接查看的 `supplemental-ios-en-P-default-live-activity-island-window.png` 只能独立支持 GUI 中展开 island 的存在及布局，不补造原生矩阵截图。

### 其他边界与下一步验证（本轮未执行）

- 没有连续播放两段 MP4，仅直接查看它们的已有接触表；采样不足以证明帧间平滑、手势可中断性或 transient 的持续时长。
- 没有最新桌面完整 UI 参照；图标生成器的导入关系只能支持来源，不能支持完整像素/品牌对齐。
- 真机签名、entitlements/capabilities、首次系统 VPN 授权、取消/拒绝/撤权与 On Demand 都未验证。F3 需在真实配置保存/重载期间取消，确认不发生迟到启动。
- 真实 Network Extension、sing-box 出口、DNS/IPv4/IPv6/QUIC、住宅链路、断网/切网/睡眠/重启/崩溃/jetsam 下的 fail-closed 和泄漏检查均未验证。模拟器 fixtures 从不证明这些。
- 真实账户及多账户请求延迟/登出/再登录/离线 fallback（F1），运行 C1 同 mode/node 取得 C2 后的 Home/RouteCheck（F2），需隔离可控服务或可注入测试验证；不可在生产靠试错跨账户流量证明。
- 物理触觉、VoiceOver 顺序/Magic Tap、Switch Control、Reduce Motion/Transparency/Increase Contrast 系统设置、实际小屏与 AX5 滚动，以及 widgets/Control Center/Live Activity 的刷新、过期、隐私和系统语言，尚无真机通过结论。
- 没有 120 Hz frame pacing、热量/耗电、真实网络性能或 extension 内存压力验收；不能把 fixture 的 66 MB app 峰值套到 NE 的内存限额。

VERDICT: FAIL 82.5
