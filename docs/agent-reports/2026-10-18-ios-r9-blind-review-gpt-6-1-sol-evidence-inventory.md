# PR #1672 第 9 轮独立盲审：证据清单

- 评审模型：GPT-6.1 Sol / `gpt61s`；仅本线程独立审阅。
- 固定代码：[b36d07d7907f39364f1cfe4309d60824fea9d24e](https://github.com/raydocs/tono/commit/b36d07d7907f39364f1cfe4309d60824fea9d24e)。
- [Run 39140462842](https://github.com/raydocs/tono/actions/runs/39140462842)，2026-10-18 15:26:09Z 创建，16:15:27Z 更新为完成；两个 job 均成功。
- [Artifact 12142836958](https://github.com/raydocs/tono/actions/runs/39140462842/artifacts/12142836958)，`ios-preview-screenshots`，ZIP 605,197,961 bytes。
- ZIP SHA-256：`f2fe447850ade60f60d9bdac65e67678d65ffd31731b175b1b4f99e637a39016`。
- 本目录：`/home/user/workspace/repo/.amp/in/artifacts/ios-pr1672-r9-independent/`。
- 原件位于 `evidence/`，共 **77 项 = 65 PNG + 5 MP4 + 7 文本/JSON**。逐文件 bytes / SHA-256 见 `evidence-manifest.tsv`，视频技术元数据见 `media-metadata.json`。
- 系统运行环境：iPhone 17 Pro，iOS 26.5 **模拟器**，不能称为实体手机证据。

## 1. 主张与可核对位置

| 主张 | 原文件 / 相对原视频时间码 | 判读边界 |
|---|---|---|
| 首页主要操作与层级 | `en-02-idle.png`、`en-03-connecting.png`、`en-04-connected.png`、`en-06-failed.png` 及中文对应图 | fixture 的可见设计，不是实网状态 |
| 默认 Details 查询位置 | `en-09-details.png`、`zh-Hans-09-details.png`；展开对照 `en-09b-details-full.png` | 半屏折叠线与大 sheet 的实际可见区别 |
| 键盘部分遮住控件底缘 | `ui-tests.mp4` 09:45、10:03；`derived/ui-tests-585s.png`、`derived/ui-tests-603s.png` | 输入文字与 Check 标签仍可见；不是提交后结果不可见 |
| 提交后结果真正可见 | `details-route-check.png`；`ui-tests.mp4` 09:46–09:48、10:04–10:06 | 键盘消失、答案及依据说明完整可见 |
| 预览模式切换重算答案 | `details-route-check-stable.png`；`ui-tests.mp4` 09:49–09:50；`derived/ui-tests-589s.png` | Direct → Cloud，UDP → Blocked；不证明真实运行图应用成功 |
| 编辑已有答案后的域名 | 没有相应运行画面；源码 `SettingsView.swift:172–180` | 仅源码预期清除，不记为运行通过 |
| 中文状态循环 | `state-cycle.mp4` 约 00:02 / 00:05 / 00:11 / 00:17 / 00:18–00:19 / 00:23–00:24 | Connected / Degraded / Reconnect / Disconnecting / Idle / Failed |
| 英文状态循环 | `state-cycle-en.mp4` 约 00:03 / 00:06 / 00:12 / 00:17 / 00:19 / 00:23 | 与中文对应；程序化 fixture |
| Reduce Motion | `state-cycle-reduce-motion.mp4` 全段，结合 `SeaScene.swift:15–23` | 停持续漂移/呼吸/扫光；静态填充仍能随状态改变 |
| sheet 材质 | `sheet-zoom.mp4` 00:00–00:02 / 00:05–00:06 / 00:09–00:10 | Lines / Details / Settings；不是真人点按录像 |
| AX5 主操作 | `a11y-largest-text-en-connected.png` | 主断开可读，底部次要入口越过视口 |
| AX5 widget 覆盖不足 | `a11y-largest-text-en-widgets.png` | 仅导语，不证明下方卡片布局 |
| 真实系统 widget | `real-widget-gallery.png`、`real-widget-home-screen.png`；`ui-tests.mp4` 12:32、12:35 | 已放置、可读，但展示的是 Status unavailable 空态 |
| 系统 ActivityKit fixture | `live-activity-island-compact.png`、`live-activity-island-expanded.png` | 系统宿主是真实的，内容仍为 Preview |
| 22 项 XCUITest | `ui-tests.log` 结尾及各 test case passed 行 | 22 passed / 0 failed / 0 skipped；不是本轮重新运行 |
| 真实性日志 | `ui-tests.log` 的 `REAL-WIDGET` 行 | `gallery-lists-tono=yes gallery-text-exposed=no placed-and-read=yes` |
| 性能取样 | `perf.txt`、`ui-tests.log` 的 `testSimulatorPerformanceSample` | 模拟器 CPU/RSS/XCTest 取样，不推导真机 FPS/耗电 |
| 严重状态误导 | `source/` 内 AppModel、TunnelController、PacketTunnelProvider、ConnectionState、DetailsSheet、SettingsView | 源码可达失败序列；没有故障注入或已测泄漏证据 |

## 2. 全部 65 张原始 PNG

全部通过联系表全览；报告引用的关键图另做原尺寸放大检查。列出文件不表示每张图都做了像素级或 VoiceOver 验证。

### 英文 23 张

- `en-01-signin.png`
- `en-02-idle.png`
- `en-02b-permission.png`
- `en-03-connecting.png`
- `en-03a-preparing.png`
- `en-04-connected.png`
- `en-05-degraded.png`
- `en-06-failed.png`
- `en-07-lines.png`
- `en-08-settings.png`
- `en-09-details.png`
- `en-09b-details-full.png`
- `en-10-onboarding.png`
- `en-11-vpn-primer.png`
- `en-12-network-changed.png`
- `en-13-dropped.png`
- `en-14-offline.png`
- `en-15-lines-empty.png`
- `en-16-lines-loading.png`
- `en-17-widgets.png`
- `en-17b-widgets-light-wallpaper.png`
- `en-17c-widgets-control-symbols.png`
- `en-18-system-light-appearance.png`

### 简体中文 20 张

- `zh-Hans-01-signin.png`
- `zh-Hans-02-idle.png`
- `zh-Hans-02b-permission.png`
- `zh-Hans-03-connecting.png`
- `zh-Hans-03a-preparing.png`
- `zh-Hans-04-connected.png`
- `zh-Hans-05-degraded.png`
- `zh-Hans-06-failed.png`
- `zh-Hans-07-lines.png`
- `zh-Hans-08-settings.png`
- `zh-Hans-09-details.png`
- `zh-Hans-09b-details-full.png`
- `zh-Hans-10-onboarding.png`
- `zh-Hans-11-vpn-primer.png`
- `zh-Hans-12-network-changed.png`
- `zh-Hans-13-dropped.png`
- `zh-Hans-14-offline.png`
- `zh-Hans-15-lines-empty.png`
- `zh-Hans-16-lines-loading.png`
- `zh-Hans-17-widgets.png`

### 无障碍 13 张

- `a11y-increase-contrast-connected.png`
- `a11y-large-text-connected.png`
- `a11y-large-text-details.png`
- `a11y-large-text-signin.png`
- `a11y-largest-text-en-connected.png`
- `a11y-largest-text-en-details.png`
- `a11y-largest-text-en-idle.png`
- `a11y-largest-text-en-onboarding.png`
- `a11y-largest-text-en-primer.png`
- `a11y-largest-text-en-settings.png`
- `a11y-largest-text-en-widgets.png`
- `a11y-reduce-transparency-connected.png`
- `a11y-reduce-transparency-details.png`

### 交互与系统宿主 9 张

- `details-route-check-stable.png`
- `details-route-check.png`
- `interrupted-start-arrives-connected.png`
- `live-activity-island-compact.png`
- `live-activity-island-expanded.png`
- `other-line-opens-lines.png`
- `real-widget-gallery.png`
- `real-widget-home-screen.png`
- `settings-scrolled-under-bar.png`

## 3. 全部五段原始 MP4

全部 H.264 / 1206×2622。时码相对各自原文件起点；提取帧按该时码解码，不是经过剪辑后重置时码的录像。帧率元数据不能当作 UI 测得的帧率。

| 文件 | ffprobe 时长 | 本轮检查方式 |
|---|---:|---|
| `sheet-zoom.mp4` | 26.548333 s | 全长采样及材质/切换片段 |
| `state-cycle-en.mp4` | 30.596667 s | 全长状态/动效采样 |
| `state-cycle-reduce-motion.mp4` | 29.001667 s | 全长采样，结合动画开关源码 |
| `state-cycle.mp4` | 29.803333 s | 全长状态/动效采样 |
| `ui-tests.mp4` | 764.845000 s | 全程概览，09:43–10:07 Details、末段系统 widget 重点检查 |

## 4. 全部七项原始文本/JSON

- `Libbox.provenance.json`：二进制来源元数据，不作为视觉评分依据。
- `README.txt`：证据说明；不作为原始像素/日志的替代。
- `device.txt`：模拟器设备标识。
- `install.txt`：安装结果。
- `launches.txt`：证据捕获启动输出。
- `perf.txt`：五次一组的 CPU/RSS 模拟器取样。
- `ui-tests.log`：XCUITest 完整输出、审计重新判读日志、22 项测试结果、REAL-WIDGET 行、性能指标。

## 5. 本轮保留的派生证据与溯源文件

`derived/` 保存九张原尺寸视频解码帧，不是新增测试：

| 文件 | `ui-tests.mp4` 原时码 |
|---|---|
| `ui-tests-583s.png` | 09:43 |
| `ui-tests-585s.png` | 09:45 |
| `ui-tests-588s.png` | 09:48 |
| `ui-tests-589s.png` | 09:49 |
| `ui-tests-601s.png` | 10:01 |
| `ui-tests-603s.png` | 10:03 |
| `ui-tests-604s.png` | 10:04 |
| `ui-tests-752s.png` | 12:32 |
| `ui-tests-755s.png` | 12:35 |

- `run.json`：固定 run 的 API 响应。
- `artifact.json`：固定 artifact 的 API 响应。
- `jobs.jsonl`：两个 job 的 API 响应，每行一项。
- `rubric.txt`：仅从指定 PR rubric 段提取的原文行，不含其他正文区域。
- `evidence-manifest.tsv`：77 项原件的文件名 / bytes / SHA-256。
- `media-metadata.json`：五段 MP4 的 ffprobe 输出。
- `source-manifest.tsv`：下列 22 个源码副本与固定 head 逐一核对后的 bytes / SHA-256。
- `verification-receipt.txt`：哈希、固定 head、65 项 PNG 清单、22 项既有测试汇总及评分算术的本轮核对回执；明确列出未运行项。
- `review.md`：完整评审原文。

锁定 `source/` 副本保留原仓库相对路径：

- `apps/ios/App/Model/AppModel.swift`
- `apps/ios/App/Services/TunnelController.swift`
- `apps/ios/App/Views/SettingsView.swift`
- `apps/ios/App/Views/DetailsSheet.swift`
- `apps/ios/App/Views/Theme.swift`
- `apps/ios/App/Views/Components.swift`
- `apps/ios/App/Views/SeaScene.swift`
- `apps/ios/App/Views/HomeView.swift`
- `apps/ios/App/Views/WidgetGallery.swift`
- `apps/ios/PacketTunnel/PacketTunnelProvider.swift`
- `apps/ios/Shared/SharedFiles.swift`
- `apps/ios/TonoKit/Sources/TonoKit/ConnectionState.swift`
- `apps/ios/TonoKit/Sources/TonoKit/RouteExplainer.swift`
- `apps/ios/UITests/TonoUITests.swift`
- `apps/ios/Widgets/StatusWidget.swift`
- `apps/ios/WidgetUI/StatusViews.swift`
- `apps/ios/WidgetUI/StatusPresentation.swift`
- `apps/macos/Tono/Views/SeaComponents.swift`
- `apps/macos/Tono/Views/DashboardView.swift`
- `apps/macos/Tono/Views/SeaSceneLayerView.swift`
- `apps/macos/Tono/Views/SeaSceneWater.swift`
- `.github/workflows/ios-ci.yml`

**未提供也未声称通过：** 旧 head Red、域名编辑运行复验、故障注入、真机单手/VoiceOver、实际账号/联网 tunnel、真实锁屏 widget 放置、控制中心真实切换、实体手机持续性能/电池验证。
