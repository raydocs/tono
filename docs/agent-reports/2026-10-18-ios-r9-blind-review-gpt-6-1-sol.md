# raydocs/tono iOS PR #1672：第 9 轮独立盲审

**结论：86/100。总分 ≥85、七项均 ≥70%，但总体不通过；存在源码可达的严重路由状态误导，触发否决。未达到 95，不为目标凑分。**

## 1. 固定对象、独立性与方法

- 实际评审模型：**GPT-6.1 Sol，Amp 模式 `gpt61s`，高推理**。本线程独立完成，未创建子线程，未调用其他评审代理或 Oracle。
- 仓库 / PR：`raydocs/tono` / [#1672](https://github.com/raydocs/tono/pull/1672)。
- 唯一代码 head：[b36d07d7907f39364f1cfe4309d60824fea9d24e](https://github.com/raydocs/tono/commit/b36d07d7907f39364f1cfe4309d60824fea9d24e)。源码从该提交单独导出；报告所列行号均指这个快照。
- 已检查日志 tip [8dd22e21dab25f73530b5b2fe4947e2a98ede885](https://github.com/raydocs/tono/commit/8dd22e21dab25f73530b5b2fe4947e2a98ede885) 相对锁定 head 的文件统计：仅一份 changelog、15 行新增。**没有改用 tip 或之后的代码，也没有读取该 changelog 的评审内容。**
- 固定 [run 39140462842](https://github.com/raydocs/tono/actions/runs/39140462842)，[artifact 12142836958](https://github.com/raydocs/tono/actions/runs/39140462842/artifacts/12142836958)。API 的 run head 与 artifact head 均与锁定 head 相同。
- PR 正文只定向提取 `Rubric (verbatim, unchanged)` 下的原文；未读取正文其他区域的旧分数、`docs/agent-reports`、旧评审/实施笔记、其他盲审线程，未询问或查看实施方自评分。
- 核验全部 65 张 PNG 的联系表，关键图放大检查；五段视频均检查，四段短片做全时段采样，长片做全程概览及 Details、系统 widget 重点片段检查。**这不是逐帧审计，也不是真机现场操作。**
- 证据设备是 **iPhone 17 Pro / iOS 26.5 模拟器**，不是实体 iPhone。视觉、源码推论、运行证据与未验证项分开表述。

Rubric 原文（不改写）：

> "统一100分：信息层级减字20、交互连贯单手20、高级克制及最新桌面品牌一致15、Liquid Glass材质15、状态动效15、可访问性适配10、真实性性能5；>=85且各项>=70%，严重状态误导/主操作难发现/不可读一票否决。"

## 2. 七维评分

| 原维度 | 得分 / 满分 | 项内比例 | 判断与扣分依据 |
|---|---:|---:|---|
| 信息层级减字 | **18.5 / 20** | 92.5% | 首页状态、主要操作、线路层级明确，中英均可读。Details 的故障解释、三条流向和查询叠在一起仍偏长，半屏首屏信息较拥挤。 |
| 交互连贯单手 | **17 / 20** | 85% | 底部连接/取消/断开/重试容易找到；提交查询后键盘消失且结果真正可见。输入时控件底缘被键盘遮住，默认半屏下查询/模式在折叠线附近或以下；没有实体单手操作证据。 |
| 高级克制及最新桌面品牌一致 | **13 / 15** | 86.7% | 日轮、地平线、海面、暖色控件与当前桌面 Horizon 源码同族。iOS 玫紫底色和梯级横线倒影仍较插画化，精细度未到 95 档；未做同环境桌面渲染对照，不能声称像素级一致。 |
| Liquid Glass材质 | **13 / 15** | 86.7% | 控制层有透底、上缘受光，sheet 内卡片没有层层玻璃。源码确实调用 iOS 26 `glassEffect`，并有降低透明度/增强对比回退；但深色胶囊仍有较强描边、烟色实体感，真实触摸折射与不同壁纸覆盖有限。 |
| 状态动效 | **12 / 15** | 80% | 首连、部分可用、重连、断开、失败有不同词语和节奏；Reduce Motion 会停持续海面漂移和重连扫光。但“新模式已显示、旧路由仍运行”的失败路径没有真实应用确认，是本项主要扣分及否决来源。 |
| 可访问性适配 | **8.5 / 10** | 85% | 有 AX 大字、最大字号、降低透明度、增强对比、减少动态效果证据，主要操作保持可读。AX5 首页次要入口越过视口；widget AX5 图未覆盖实际卡片；自动审计有自定义过滤，未验证 VoiceOver 顺序/播报及最大字号键盘组合。 |
| 真实性性能 | **4 / 5** | 80% | 真实模拟器 SpringBoard widget 放置及读取成立，预览有明确标记，run/head 对应。真实 widget 只证明“状态不可用”空态；无实网隧道、实机耗电/帧率、真实锁屏/控制中心完整操作证据。 |
| **总计** | **86 / 100** | **86%** | **数值门槛通过，否决项不通过，95 目标未达到。** |

这是对该 head 的现状评分，不是与旧轮次或实施方评分比较。已录制的 fixture 画面中，没有观察到首页主操作难发现或整体不可读的否决；不能据此排除源码中的严重状态误导。

## 3. P1：模式应用失败后仍按新模式描述流量，触发状态误导否决

**证据等级：源码推导的可达失败路径；未在模拟器或真机注入故障复现，不声称已经测出实网泄漏。**

用户在正在运行的 Three-tier 下查询 `example.com`，答案是直连。切到 Stable 后，界面立即选中 Stable，把该站答案和 Other apps 改成 Cloud；若新输入未写入或 reload 没有完成，旧 Three-tier 仍可运行。界面没有“待应用/应用失败，仍使用旧模式”的对应表达。

锁定源码链条：

1. [AppModel.swift:320–324](file:///home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-independent/source/apps/ios/App/Model/AppModel.swift#L320-L324)：先发布 `mode = newMode`，再保存偏好并调用 `pushInputs()`。`DetailsSheet.swift:129–149` 没有禁止已连接时切换。
2. `apps/ios/App/Views/SettingsView.swift:184–186` 在 `model.mode` 变化时重算已有答案；`AppModel.swift:355–359` 用这个期望模式建图解释域名。`DetailsSheet.swift:99–100` 的 Other apps 也读取期望模式，而非隧道确认过的模式。
3. [AppModel.swift:369–377](file:///home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-independent/source/apps/ios/App/Model/AppModel.swift#L369-L377) 用 `try?` 吞掉输入保存错误；非空 reload 错误回复只设置 `CORE_START`，没有回滚模式。nil 回复走探测分支。[TunnelController.swift:112–119](file:///home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-independent/source/apps/ios/App/Services/TunnelController.swift#L112-L119) 又把发送失败转换成 nil，因此 nil 同时代表正常 reload 返回和发送失败。
4. [PacketTunnelProvider.swift:103–113](file:///home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-independent/source/apps/ios/PacketTunnel/PacketTunnelProvider.swift#L103-L113) 明确保留 reload 失败前的图；`:173–185` 重读共享文件再启动图。一个更直接的见证是：原子写入失败留下旧文件，错误被吞掉，extension 成功重读旧文件，UI 却已经显示新模式。
5. `TonoKit/Sources/TonoKit/ConnectionState.swift:147–151` 的 connected 分支按探测结果派生状态，未呈现该应用错误；`AppModel.swift:456–469` 的两个固定服务探测不能证明 `example.com` 已从直连切成 Cloud。因此旧图仍健康时，界面还可能重新显示 Connected。

**为什么“not a live test”不足以解除问题：** 它合理地说明域名查询不是即时连通测试，却没有说明选中的路由模式尚未生效。尤其 Other apps 位于 `WHERE TRAFFIC GOES` 下，并不是单独的“拟议规则预览”。用户会据此判断流量是否直连；旧图继续运行且无有效模式提示，属于严重路由状态误导。

预览测试不能覆盖这一点：`AppModel.swift:322` 在 `isPreview` 时直接返回，根本不执行输入写入和 tunnel reload。录屏中切换成功，证明的是预览答案随选择变化，不是运行图成功切换。

**建议：** 区分期望模式与已确认运行模式；等待应用结果，失败时明确保留旧模式并显示失败/待应用，或回滚选择。查询和流向应描述已确认运行图，或明确标为未生效的计划。用两种模式结果不同的域名，注入保存/发送/reload 失败，检查选择、答案、流向和连接说明保持一致。此处仅提出修复/验证建议，本轮未实现。

## 4. P2：Details 的结果可见已成立，键盘布局和后续编辑仍需区分

### 4.1 已有真实画面支持的部分

- `details-route-check.png`、`ui-tests.mp4` **09:46–09:48**：提交后键盘消失，完整显示 `example.com goes directly over your own network`、TCP Direct / UDP Direct 和“规则解释、非实时测试”说明。不是只在 accessibility tree 中存在。
- `details-route-check-stable.png`、`ui-tests.mp4` **09:49–09:50**：同一答案变为 Cloud，UDP 为 Blocked，Other apps 也变为 Cloud，Stable 选中。**这是预览的可见交互证据，不是实际 tunnel reload 证据。**
- `ui-tests.mp4` **10:04–10:06** 第二次提交也能看到直连结果；不能把两次独立启动误读为同一次查询后的域名编辑。

### 4.2 画面仍有的问题

`ui-tests.mp4` **09:45、10:03**，对应 `derived/ui-tests-585s.png`、`derived/ui-tests-603s.png`：输入文字/光标区域及 Check 文本可见，但圆角输入框和 Check 控件的下缘被键盘顶边盖住。**不是整项不可用，也不是提交后答案仍被盖住；但不能称为控件已完整避让键盘。**

`en-09-details.png` 与 `zh-Hans-09-details.png` 的默认半屏先放故障 banner 和流向，查询下部/模式位于折叠线附近或以下；`en-09b-details-full.png` 才完整展开。建议键盘出现后进一步滚动输入区，给输入和按钮底缘留清晰间距；用真实轻点/键盘提交及 AX5 组合重新捕获。默认半屏可收紧解释布局或提供更明显的查询入口，不必增加首页主要按钮。

### 4.3 证据缺口，不当作已证实缺陷

在已有答案后编辑成另一个域名，没有对应测试和录屏。`SettingsView.swift:172–180` 会在清洗后的 host 不同时清空答案，这是合理的源码实现；**仅能推论预期正确，不能报为已运行通过。** 后续应记录 `example.com` 查询后改成路由不同的域名，确认旧答案立即消失、新答案只描述新域名，并覆盖最大字号和键盘同时出现的状态。

## 5. 玻璃、动效、无障碍与真实性的证据边界

**玻璃与品牌：** `en-04-connected.png` 有暖色透底胶囊和亮边；`sheet-zoom.mp4` **00:00–00:02 Lines、00:05–00:06 Details、00:09–00:10 Settings** 显示同一组 sheet 材质。`App/Views/Theme.swift:176–190` 的原生 glassEffect 与不透明回退可核实；不能把 API 存在直接当作全部视觉质量已满分。桌面比对使用该 head 的 `SeaComponents.swift`、`DashboardView.swift`、`SeaSceneLayerView.swift`/`SeaSceneWater.swift`，不是旧紫色主题；只支持设计家族一致，不支持同屏视觉完全一致。P3 建议弱化梯级倒影的等距感与胶囊描边，保留当前文字对比度，不为“更玻璃”牺牲可读性。

**状态动效：** `state-cycle.mp4` 约 **00:02 已连接、00:05 部分可用、00:11 重连、00:17 断开中、00:18–00:19 夜景、00:23–00:24 失败**；英文片相应约 **00:03 / 00:06 / 00:12 / 00:17 / 00:19 / 00:23**。状态词、主要操作与场景有区分，未见持续文字冲突。`state-cycle-reduce-motion.mp4` 与 `SeaScene.swift:15–23` 支持减少动态效果时停止持续漂移/呼吸/扫光；静态进度填充改变不等于仍有扫光。淡入淡出仍可能保留。`sheet-zoom.mp4` 是程序化循环，不作为真人点按顺畅度证明。

**无障碍：** `a11y-largest-text-en-connected.png` 的主断开按钮可读，底部 gear/Details 越过当前视口，不等于完全不可达；`a11y-largest-text-en-widgets.png` 只展示导语，不能证明下方 widget 卡片的最大字号体验。降低透明度和增强对比截图有可读的实体回退。`UITests/TonoUITests.swift:472–521` 对 Apple audit 做了自定义处理：对比度按截图重新估计、最大字号 textClipped 预测被豁免、固定 widget 卡片的 dynamicType/textClipped 被豁免。**绿测试不是“Apple 原始审计零问题”，更不是 VoiceOver 顺序、焦点、听到的播报已验证。** P2 建议补最大字号键盘场景、实际卡片滚动和 VoiceOver 听读证据。

**真实系统容器 ≠ 真实连接：**

| 证据 | 实际证明 | 没有证明 |
|---|---|---|
| `real-widget-gallery.png` | 模拟器系统 widget 选择器确有 Tono 项和可见渲染 | gallery 的文字都被 AX 暴露；日志实际为 `gallery-text-exposed=no` |
| `real-widget-home-screen.png`；`ui-tests.mp4` **12:32 编辑态、12:35 放置后** | 真实 SpringBoard 容器已放置，内容是 **Status unavailable / Open Tono to see the status**；日志为 `placed-and-read=yes` | 真实 Connected/Degraded 状态同步、实际联网和耗电 |
| `en-17-widgets.png`、`en-17b-widgets-light-wallpaper.png`、`en-17c-widgets-control-symbols.png` | 应用内 widget/锁屏/控制符号预览 | 系统锁屏放置、控制中心真实开关 |
| `live-activity-island-compact.png`、`live-activity-island-expanded.png` | 模拟器 ActivityKit 系统宿主能展示 fixture；展开态明确 Preview | 生产连接状态正确、真机锁屏生命周期 |

真实 widget 截图顶端的绿色岛来自此前 fixture Live Activity；`AppModel.swift:519–532` 将预览 Activity 与共享 widget 状态分开。不能拿它与空态 widget 拼成“生产状态矛盾”，也不能把这个绿色岛当作真实 VPN 在线证据。

**性能：** `perf.txt` 的五次采样 CPU 均值：connected 5.22%、Reduce Motion 0.18%、idle 6.68%；RSS 约 209,000 KB（约 204 MiB）。`ui-tests.log` 另有 XCTest physical memory 平均 59,360.107 kB、CPU time 4.997 s；测量口径不同，不能直接合并。cycles / instructions 为 0，不是零开销证明。视频帧率元数据也不是 UI 实测帧率。没有真机电池、持续温升、真实隧道内存、掉帧或物理触摸延迟结论。

## 6. 验证记录与交付状态

- **沿用并核对的 Green：** 固定 run 的 Linux、macOS 两个 job 均 success；`ui-tests.log` 原始汇总是 `Executed 22 tests, with 0 failures (0 unexpected)`，22 项均执行、零跳过。22/22 指 XCUITest 测试，不是 22 个 CI job。
- **真实 widget 原始行：** `REAL-WIDGET gallery-lists-tono=yes gallery-text-exposed=no placed-and-read=yes`。已与实际图片/视频比对，未把日志代替可见性判断。
- **本轮运行：** Git 固定提交导出与 tip 文件统计、run/artifact API 对应检查、ZIP 校验和、77 项文件哈希/媒体元数据检查、图像和视频审阅、必要源码路径追踪。
- **Red：未执行。** 没有在旧 head 上运行回归，也没有把旧问题描述、测试源码或绿 CI 冒充 Red。
- **未运行：** 本 orb 无 Apple 运行环境，未重跑 Xcode/XCTest；未执行故障注入、实网隧道、实体 iPhone、VoiceOver 听读、真实锁屏/控制中心和真机性能验证。
- **建议顺序：** 先消除 P1 运行模式/显示模式不一致；再处理 P2 键盘完整避让并补编辑域名/AX5/VoiceOver 证据；最后做 P3 水面和玻璃精细度打磨。未验证项不直接判为产品故障，也不能记作通过。
- **交付：** 仅本地 Markdown、原始证据、选定视频帧和锁定源码快照。未实现修复、未提交或推送、未发 GitHub/实施线程、未合并或发布。只向请求本审的 Puck 回报；不声称另一份独立复审已完成。

本地文件：

- 完整报告：`/home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-independent/review.md`
- 完整证据清单：`/home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-independent/evidence-inventory.md`
- 77 项原文件大小与 SHA-256：`/home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-independent/evidence-manifest.tsv`
- 原始证据目录：`/home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-independent/evidence/`
- 锁定源码副本：`/home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-independent/source/`
- 选定解码帧：`/home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-independent/derived/`
- 原 ZIP SHA-256：`f2fe447850ade60f60d9bdac65e67678d65ffd31731b175b1b4f99e637a39016`。

## 7. 关键视觉证据

以下都是固定 artifact 的原图或原视频解码帧；前三张是预览，第四张是真实模拟器 SpringBoard 的空态 widget，不是真实 VPN 连接证明。

:::gallery grid
![Details：提交后结果完整可见](file:///home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-independent/evidence/details-route-check.png)
![Details：09:45 键盘遮住输入控件底缘](file:///home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-independent/derived/ui-tests-585s.png)
![Details：预览切到 Stable 后答案改为 Cloud](file:///home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-independent/evidence/details-route-check-stable.png)
![真实模拟器主屏 widget：Status unavailable 空态](file:///home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-independent/evidence/real-widget-home-screen.png)
:::
