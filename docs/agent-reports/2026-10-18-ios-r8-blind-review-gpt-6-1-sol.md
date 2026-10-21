# Tono iOS 第 8 轮独立盲审：87.5 / 100

**结论：达到原 rubric 的 85 分及单项 70% 门槛；未在所查证据中确认一票否决项。未达到 95 分，不构成真机、联网或发布验收。**

## 1. 身份、版本与盲审边界

- 评审日期：2026-10-18；仓库/PR：[raydocs/tono#1672](https://github.com/raydocs/tono/pull/1672)。
- 实际执行模型：**GPT-6.1 Sol（`gpt61s`）**；本人完成，未创建子线程或另起评审代理。
- 唯一代码版本：[217eb1e434cdbf92a7eb2312959d3e0cfdabc1e4](https://github.com/raydocs/tono/commit/217eb1e434cdbf92a7eb2312959d3e0cfdabc1e4)。源码从该提交单独导出，不以当前工作树或后续 head 替代。
- 日志 tip：[f7b7ddd50f176951932513ca5ec257b8ac6580ae](https://github.com/raydocs/tono/commit/f7b7ddd50f176951932513ca5ec257b8ac6580ae)。与固定代码版本相比只增加一份 changelog 的 7 行；不作为另一个代码版本评分。
- 核对的 CI：[39130734441](https://github.com/raydocs/tono/actions/runs/39130734441)，head 精确等于上述代码版本，两个 job 均成功。
- 原始证据：[artifact 12139096378](https://github.com/raydocs/tono/actions/runs/39130734441/artifacts/12139096378)，名称 `ios-preview-screenshots`，64 PNG、5 MP4、7 个元数据/日志文件。
- 只从 PR 正文提取原 rubric；未阅读旧评审分数/结论、另一份盲审，也未询问实施方自评分。此次未修改产品源码、提交、推送、发布 GitHub 评论、联系实施线程、合并或发布。

报告精确路径：`/home/user/workspace/repo/.amp/in/artifacts/tono-ios-r8-blind-review-gpt61s.md`（[完整 Markdown](file:///home/user/workspace/repo/.amp/in/artifacts/tono-ios-r8-blind-review-gpt61s.md)）。下文 iOS 源码路径均相对固定提交的 `apps/ios/`。

## 2. 原 rubric 与分数

> 统一100分：信息层级减字20、交互连贯单手20、高级克制及最新桌面品牌一致15、Liquid Glass材质15、状态动效15、可访问性适配10、真实性性能5；>=85且各项>=70%，严重状态误导/主操作难发现/不可读一票否决。

| 维度 | 得分 | 单项比例 | 逐维理由及扣分依据 |
| --- | ---: | ---: | --- |
| 信息层级减字 | **18 / 20** | 90% | 主屏先状态、再主操作、再线路；`Partly working` 下用一句话解释 AI 暂停，边界说明折叠进 Settings，Details 集中承载流量去向和查询。中英文结构一致。扣分在查询完成后答案没有在当前可见区域交付，以及少量说明/次要读数仍偏小；不能把“节点存在”当作信息已经送达。证据：`en-04-connected.png`、`en-05-degraded.png`、`en-08-settings.png`、`en-09b-details-full.png`、`details-route-check.png`。 |
| 交互连贯单手 | **18 / 20** | 90% | Connect/Disconnect/Retry、线路、Details 和齿轮都在下方；双入口 Settings、关闭回主屏、弹层下滑关闭有录像和 UI 测试支持。查询键盘遮挡结果破坏了这条次级任务的完成感；Details 转 Settings 先收起再打开，也有短暂回主屏的间隔。证据：`ui-tests.mp4` 08:13–08:22、08:33–08:46；不是仅凭截图推断可点击。 |
| 高级克制及最新桌面品牌一致 | **14 / 15** | 93.3% | 日出标、海平线、墨色夜景、奶油白字体与暖色主按钮延续桌面 Sea 品牌；没有按旧紫色界面评价。大面积留白与轻字重克制。扣分主要是两条胶囊上重复的宽暖色椭圆高光，略显人为贴饰；其材质问题主要计在下一项，不重复重罚。证据：`en-02-idle.png`、`en-04-connected.png`、`zh-Hans-04-connected.png`；桌面比对为固定提交内的 Sea tokens/按钮样式源码，不是假称已做跨端实机并排测试。 |
| Liquid Glass 材质 | **11.5 / 15** | 76.7% | 有真实的玻璃边缘、透色、交互控件层次及 Settings 顶部滚动模糊；不是纯平面暗卡。实际成像中两条胶囊反复出现宽椭圆色斑，Details/Lines 的烟色底又很厚，背景折射、深度与不同控件间的材质区分偏弱；Settings 标题后仍能看到模糊的另一行文字。API 正确不等于视觉满分。证据：`en-04-connected.png`、`en-07-lines.png`、`en-09-details.png`、`settings-scrolled-under-bar.png`；`sheet-zoom.mp4` 00:04–00:06、00:08–00:09、00:12–00:16。 |
| 状态动效 | **14 / 15** | 93.3% | 首次连接、部分可用、网络切换重连、断开、失败具有可辨别的标题/主操作；重连没有重播首次连接的填充过程。Reduce Motion 仍能读清状态，不依赖背景移动传意。扣分保留给正常动效下复杂交互/中断的证据不足：多数自动交互使用 Reduce Motion，不能用状态循环替代完整交互压力覆盖。证据：`state-cycle-en.mp4` 00:03–00:09、00:13–00:21、00:24–00:26；`state-cycle-reduce-motion.mp4`；`interrupted-start-arrives-connected.png`。 |
| 可访问性适配 | **8.5 / 10** | 85% | 大字状态/按钮会重排，长文可滚动；降低透明度、增强对比度有实际截图。不能给满：未获得 VoiceOver 真机朗读与焦点顺序、小屏/横屏等完整证据；审计 helper 对部分报告作重测/接受处理，并非 Apple 原始审计零问题。`en-18-system-light-appearance.png` 仍是深色，源码强制 dark；这是深色品牌选择，不能当作已验证浅色主题适配。证据：13 张 `a11y-*.png`，以及测试源码 445–517 行。 |
| 真实性性能 | **3.5 / 5** | 70% | 固定 head 的完整构建、21/21 UI 测试、真实系统 Widget 放置读取和 ActivityKit 宿主证据值得计分。与此同时，产品画面均为有标识的 fixture：无账户、无隧道、无联网；设备 Release 未签名，Widget 的真实系统画面只证明 unavailable 状态展示。CPU/RSS 只是模拟器宿主采样，不能兑换真机帧率、能耗或网络可靠性满分。 |
| **合计** | **87.5 / 100** | | **目标 95 没有被当作打分下限。** |

七项最低分依次为 14、14、10.5、10.5、10.5、7、3.5；本次全部达到。真实性性能恰在单项门槛上，不表示其未验证部分已通过。

**否决项核对：**未观察到主操作难发现、主状态整体不可读或已确认的严重状态误导。查询答案被键盘挡住是局部任务可用性缺陷；源码中的旧查询结果风险未在视频中复现，不能直接升级成“真实保护已释放却显示受保护”的已证实否决项。真实网络安全行为仍未验收。

## 3. Settings、Details 路由检查与玻璃的专项核实

**Settings 路径确实可达。**`ui-tests.mp4` 08:33–08:38 展示 Details → Settings、滚动与关闭，08:43–08:46 展示主屏底部齿轮再次打开/关闭 Settings。源码 `App/Views/HomeView.swift:135–148,206–218` 与 `UITests/TonoUITests.swift:258–334` 支持双入口和下滑回主屏。Details → Settings 先关闭 Details、等待约 450 ms 再打开 Settings，不是保留 Details 的原地嵌套导航。

**路由查询在 Details，不在 Settings。**`App/Views/DetailsSheet.swift:91–95` 将 `RouteCheck` 放在流量去向卡内。`details-route-check.png` 和视频 08:19–08:22 确认输入 `claude.ai` 后键盘仍在，TCP/UDP 答案没有显示在当前可见区域。测试 `UITests/TonoUITests.swift:339–351` 只要求 `TCP →` 节点存在，没有核对具体判定或结果是否可见，故绿色不能证明这一交互闭环已经完成。

**这是配置解释，不是联网探测。**`App/Model/AppModel.swift:350–354` 从当前 catalog、mode 等构建配置，再调用 `RouteExplainer`。不能把该查询的答案写成已经测通目标网站、已证明运行隧道使用该结果或完成真机路由验证。

**玻璃实现与成像分开评价。**`App/Views/Theme.swift:171–240` 使用 iOS 26 `.glassEffect`，同时叠加 `catchLight` 椭圆径向渐变；`App/Views/LinesSheet.swift:125–135` 给系统 sheet 加不透明度 0.72 的烟色底。原生能力存在，但不能据此忽略截图中重复的椭圆高光和偏厚烟色。Settings 滚动模糊是真实可见的，不应说成“完全没有玻璃”；也不应把 Settings 的 zoom 推广为所有弹层都采用相同变形。`sheet-zoom.mp4` 由 fixture 自动打开，不是手指点击证据。

## 4. 按优先级排列的具体建议

1. **P1，截图/视频支持：让查询答案在提交后直接可见。**关闭键盘，或把结果滚入可见区域，并保持足够上下文。回归用例应核对指定域名的预期 TCP/UDP 结果，以及答案位于键盘上方的可见区域；保留提交后的截图。证据：`details-route-check.png`；`ui-tests.mp4` 08:19–08:22。当前证据不足以说“完全不能查询”，但足以否定“结果可读已被测试证明”。
2. **P1，code-only，未在录像复现：避免把旧查询结果呈现在新输入或新模式下。**`SettingsView.swift:168–200` 的结果只在 `run()` 写入；普通编辑域名不清空结果，切换 mode/config 也不使它失效。Details 的模式选择仍保留同一个查询视图。建议清除/重算，或明确标注“上次查询的域名、模式”。可用固定样本中的 `example.com` 区分：三层模式 TCP 直连，Stable TCP 走云且普通 UDP 被拒绝；不要用两种模式结果相同的 AI 域名掩盖问题。对应配置差异见 `TonoKit/Tests/TonoKitTests/RoutingTests.swift:38–43`。
3. **P2，视觉判断：减轻宽椭圆高光，保留真实材质差异。**降低两条胶囊上同步出现的色斑面积/强度，优先通过边缘、透色和受控的局部亮度表达厚度；对 sheet 烟色做可读性约束下的小幅比较，不建议为了“更玻璃”牺牲文字对比。复验需包含冷/暖背景与滚动后的 Settings 标题栏。
4. **P2，code-only 的状态说明：把“下次连接生效”放在开关附近。**`AppModel.swift:324–330` 明确 include-all 变更下次启动生效，且 `prepare` 错误被 `try?` 吞掉；英文完整说明有该句，但默认短说明没有（`en.lproj/Localizable.strings:109–111`）。建议变更后就地显示 pending/失败反馈，避免用户把偏好值当成当前系统已生效值。未据此声称录像中实际发生了保护失效。
5. **P2，验证缺口：补真机/签名/联网与性能证据，再争取真实性和适配满分。**至少覆盖签名设备上的权限首次授权、真实连接/重连/断开、开关实际生效边界、Widget/Live Activity 新鲜/过期/停止状态，以及 VoiceOver 和较小屏幕。当前未验证不能写成失败，也不能写成通过。

## 5. 已核实的 CI 事实与未验证范围

以下是读取既有原始日志和录像的结果，**不是本评审在 Linux orb 重新执行 Xcode/XCUITest**：

```text
gh run view 39130734441 --json headSha,conclusion,status,jobs
headSha=217eb1e434cdbf92a7eb2312959d3e0cfdabc1e4
status=completed; conclusion=success; jobs=2/2 success

ui-tests.log: started=21; passed=21; failed=0; skipped=0
Executed 21 tests, with 0 failures ... in 635.476 seconds
** TEST EXECUTE SUCCEEDED **
REAL-WIDGET gallery-lists-tono=yes gallery-text-exposed=no placed-and-read=yes

TonoKit: Linux 61/61 pass; macOS 61/61 pass
sing-box route checks: 4 graphs; 13/11/11/13 expectations pass
```

- UI 测试环境为 iPhone 17 Pro 模拟器、iOS 26.5、Xcode 26.6；simulator Debug 与 unsigned device Release 构建成功，不是已签名真机包验收。
- 21/21、零跳过属实。但 a11y helper 对渐变/玻璃对比告警做自定义像素重测，并接受 AX5 的部分 clipping 预测及固定 Widget 的 Dynamic Type/clipping 告警。其百分位亮度算法不等同逐字像素对的完整 WCAG 认证；不表述为“Apple 全量原始审计无告警”。
- `real-widget-gallery.png`、`real-widget-home-screen.png` 与 `ui-tests.mp4` 10:35–10:53 支持真实系统图库、添加和读取，显示 **Status unavailable**。`gallery-text-exposed=no` 是图库预览文字未暴露，不能抹去随后放置并读取成功的证据。
- `live-activity-island-compact.png`、`live-activity-island-expanded.png` 是真实模拟器 ActivityKit 宿主里的 fixture，展开态带 Preview；不能与独立的 unavailable Widget 拼接成真实保护状态矛盾。
- `en-17*`/`zh-Hans-17-widgets.png` 是应用内 Widget 预览，`en-17c-widgets-control-symbols.png` 是应用内符号演示；不是系统 Control Center 或用户放置的 Lock Screen 验证。
- `perf.txt` 中正常动效 CPU 约 6.8–8.1%，Reduce Motion 约 0.2–0.7%，RSS 约 210000 KiB，均为模拟器宿主采样，无真机 FPS、能耗和验收阈值，不能作“已达生产性能标准”的结论。
- 未验证：真实账户登录、签名设备/分发 entitlement、真实隧道/出口联网/网络切换安全性、触觉、系统 Control Center 控件、真实 Lock Screen 放置、真机读屏与完整设备适配。原 rubric 的有限证据通过不替代这些发布条件。

## 6. 证据清单及复核方法

已查看全部 64 张 PNG（带原文件名的联系表；关键状态另查原尺寸）、4 段短视频全段，以及 11 分钟 UI 录像的全程概览和路由检查、Settings、中断/Widget 等重点片段。长视频引用时间以原始帧 PTS 复核；未用转码后的帧序号推算原视频时间。

原始 ZIP 653493109 字节，SHA-256：`c7fc7b213f76ea1710890a2825537d181595bfabbccf89107e48f37b8b66706a`。

本地证据目录：`/home/user/workspace/repo/.amp/in/artifacts/tono-ios-r8-evidence/`。保存 64 张原始 PNG、7 个原始元数据/日志文件、完整 run log、76 项逐文件 SHA-256 清单和 4 张原始 PTS 联系表。5 段原始 MP4 仍以本节 artifact 为权威来源，未在该目录重复存储。

完整逐文件清单：[evidence-manifest.tsv](file:///home/user/workspace/repo/.amp/in/artifacts/tono-ios-r8-evidence/evidence-manifest.tsv)。CI 原始日志：[run-39130734441.log](file:///home/user/workspace/repo/.amp/in/artifacts/tono-ios-r8-evidence/run-39130734441.log)。

**截图，64 张：**以下 20 个后缀分别配 `en-` 和 `zh-Hans-`，共 40 张：

```text
01-signin.png               02-idle.png
02b-permission.png          03-connecting.png
03a-preparing.png           04-connected.png
05-degraded.png             06-failed.png
07-lines.png                08-settings.png
09-details.png              09b-details-full.png
10-onboarding.png           11-vpn-primer.png
12-network-changed.png      13-dropped.png
14-offline.png              15-lines-empty.png
16-lines-loading.png        17-widgets.png
```

另外 3 张英文截图、13 张 a11y 截图、8 张 UI 证据：

```text
en-17b-widgets-light-wallpaper.png
en-17c-widgets-control-symbols.png
en-18-system-light-appearance.png
a11y-increase-contrast-connected.png
a11y-large-text-connected.png
a11y-large-text-details.png
a11y-large-text-signin.png
a11y-largest-text-en-connected.png
a11y-largest-text-en-details.png
a11y-largest-text-en-idle.png
a11y-largest-text-en-onboarding.png
a11y-largest-text-en-primer.png
a11y-largest-text-en-settings.png
a11y-largest-text-en-widgets.png
a11y-reduce-transparency-connected.png
a11y-reduce-transparency-details.png
details-route-check.png
interrupted-start-arrives-connected.png
live-activity-island-compact.png
live-activity-island-expanded.png
other-line-opens-lines.png
real-widget-gallery.png
real-widget-home-screen.png
settings-scrolled-under-bar.png
```

**视频，5 段：**

| 原文件 | 时长 | 本报告主要定位 |
| --- | ---: | --- |
| `state-cycle.mp4` | 30.312 s | 中文连接/异常/恢复/断开全循环 |
| `state-cycle-en.mp4` | 31.425 s | 00:03–00:09 成功/降级；00:13–00:15 重连；00:18–00:21 断开/空闲；00:24–00:26 失败 |
| `state-cycle-reduce-motion.mp4` | 29.678 s | 全段：减少环境运动且保留状态信息 |
| `sheet-zoom.mp4` | 23.125 s | 00:04–00:06 Settings zoom；00:08–00:09 Lines；00:12–00:16 Details/Settings |
| `ui-tests.mp4` | 671.338 s | 08:19–08:22 查询键盘/答案；08:33–08:46 Settings 双入口/滚动；10:01–10:08 中断返回；10:35–10:53 系统 Widget |

7 个原始辅助文件：`README.txt`、`Libbox.provenance.json`、`device.txt`、`install.txt`、`launches.txt`、`perf.txt`、`ui-tests.log`。

4 张复核用衍生联系表：`ui-source-pts-01.jpg`、`ui-source-pts-02.jpg`、`ui-widget-source-pts-01.jpg`、`ui-widget-source-pts-02.jpg`；均在本地证据目录，时间戳来自原 MP4 PTS，不是额外测试结果。

代表性原图（默认已连接、查询键盘态、Settings 滚动态）：

:::gallery side-by-side
![已连接：主操作清楚，但两条胶囊出现重复宽椭圆高光](file:///home/user/workspace/repo/.amp/in/artifacts/tono-ios-r8-evidence/en-04-connected.png)
![Details 查询：键盘仍在，当前画面看不到 TCP/UDP 答案](file:///home/user/workspace/repo/.amp/in/artifacts/tono-ios-r8-evidence/details-route-check.png)
![Settings 滚动：前景标题清楚，后方内容模糊透出](file:///home/user/workspace/repo/.amp/in/artifacts/tono-ios-r8-evidence/settings-scrolled-under-bar.png)
:::

**交付状态：仅本地盲审报告及证据。未发布 GitHub，未发实施线程，未实现修复，未合并或发布；是否与另一份盲审汇总由请求方在两份都完成后决定。**
