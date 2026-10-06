## 2026-10-06 · macOS 海景外观预览
- 归属：`docs/SHIP_PLAN.md` 0.0.75 UI；macOS 客户端展示层。仅源码，不改连接、PF、Helper 或 Core。
- 来源：`ba639f6a` → 本 PR 源码（以 PR head 为准）；`codex/macos-sea-ui-0075-20261006`；草稿 PR，未合 main。
- 缺陷修复：无。本次为默认关闭的外观预览，不将未实机验证的画面称为故障修复。
- 新增/优化：SwiftUI 静态海天场景；仅确认连接显示暖日景，未确认、保护中断与阻断使用非成功景；其他页面使用不暗示连接成功的静态海面背景。最小窗口的首页可滚动，以保留阻断、恢复、路由及网络操作；现有原生侧栏、页面、操作及菜单栏状态保留。设置可在本机切换深色海景和动效级别，默认关闭。降低透明度或提高对比度时隐藏装饰光晕、星点与水纹。
- 工程与测试：新增展示状态与动效偏好 XCTest；原生渲染测试用环境覆盖而非写入本机偏好，附加真实首页夜景（920×600、660×540）、确认连接、阻断、关闭外观及设置页画面，另保留场景 PNG。图片尚需 hosted CI 和人工检查，不能仅凭 PNG 大小认定视觉验收。
- CI 修正续记：draft1405/head `222d14ca` 的 macOS 原生编译失败于渲染夹具两处只读 `accessibilityReduceMotion` 环境键写入；移除这两处无效写入，保留截图夹具现有的禁用动画 transaction，不写用户默认值、不改产品逻辑。修正后原生编译仍待新 head 的 hosted CI 验证。
- 截图夹具续记：draft1405/head `33b51a104` 已编译，但仅 660×540 阻断态 Dashboard 的 `NSHostingView.cacheDisplay` 在不透明度抽样中出现 alpha 0；真实视图仍包含 `SeaDashboardScroll` 与恢复控件。夹具对未完整的离屏缓存至多再给四个 0.1 秒布局/显示机会，每次重新捕获并保留 alpha=1 与 PNG 内容断言；若合成像素仍缺失则继续失败，不用填充、裁切或替身画面。修正效果及完整画面仍待新 head 的 hosted CI 和人工检查。
- 原生窗口诊断续记：根据 660×540 阻断态离屏 PNG 全透明的 hosted 结果，在原有失败断言及 PNG 旁加入仅限 GitHub macOS runner 的 ScreenCaptureKit 独立窗口单次采样；先核对合成测试窗口的 windowID、进程、可见状态及 660×540 frame，只保存该窗口的授权图像与原始错误/状态收据，不采集桌面，也不请求额外权限。另以现有 AppState 属性增加首页阻断且唤醒恢复暂停的集成夹具，使 RecoveryNotice 与 Repair and reconnect / Restore internet 操作出现在同一真实 Dashboard，组件截图不再冒充集成证据。此诊断不是验收通过；新 head 的 hosted 执行、滚动可达性和图像审阅仍由 root 完成。
- 验证：`verify-desktop-version.py --expected 0.0.75` 通过（只验证源码版本一致）；本机按规则不运行 Xcode/Swift；hosted `ci-gate` 与截图审阅待 PR 结果。
- 候选/发布：无新包、无签名或发布；不主张 G1/G2/G4 或实机验收。
- 剩余限制：macOS 真机外观、辅助功能、窗口尺寸与动效需 owner/硬件审阅；应用图标仍待 owner 批准，未接线。

- 2026-10-06 续记：`b988f094c` / run37449742244 编译通过，普通/paused recovery 两张blocked最小窗口离屏alpha均0，未通过；诊断未执行，因为 XCTest 不透传通用CI环境。仅macos-ci测试步显式 `TEST_RUNNER_TONO_HOSTED_WINDOW_DIAGNOSTIC=1`，fixture读取去前缀变量，原像素断言不变；未增加生产权限或本机录屏。新hosted诊断待执行，不是验收。
- 2026-10-06 续记：head `6266e3b6b` 的 hosted run37451292043 在测试步持续运行，尚不能证明 SDK 回调停滞。仅测试夹具为 `SCShareableContent` 与 `SCScreenshotManager` 两次请求分别加 10 秒回调截止；锁保护一次性 continuation，超时后迟到回调忽略，原始收据记录请求、截止和超时错误，并使超时 XCTest 失败，绝不视为画面通过。新增单个超时/迟到回调 XCTest；原离屏 alpha/PNG 断言及精确合成窗口范围检查均保留。本机不运行原生测试；新 head hosted 结果与实际 PNG 仍待 root 检查。
- 2026-10-06 续记：run37451292043 最终编译通过；两张 660×540 blocked Dashboard 离屏 PNG 均全透明（各 9,093 B），原失败日志保留；相同合成窗口的原生独立窗口 PNG 为 93,000 / 122,338 B、全不透明，回调约 0.3 秒，先前停滞猜测未证实。按只读 arbiter 结论，仅这两张预选 fixture 改用同进程精确窗口的 ScreenCaptureKit 图像作唯一验收；离屏图与 alpha 收据继续以 `-offscreen` 保存，绝不改标通过。原生验收须显式 hosted flag、10 秒双回调截止、windowID/PID/可见及 WindowServer/共享窗口 frame 匹配、660×540、逐像素不透明、原 5 KB–4 MiB PNG 范围，并用本窗口公开辅助功能树的阻断状态/恢复操作（暂停态含恢复通知）位置与对应像素对比度防止空白背景误过；缺失/拒绝/超时均失败。仅测试夹具与本记录变化，无生产 UI 修改；更正 head 的 hosted XCTest、实际 PNG 人工检查、宽标题布局和真机操作仍未验证，不主张 G1/G2/UI 或硬件验收。
- 2026-10-06 续记：更正原生窗口验收的 AX 文本匹配：普通阻断要求海景标题 `Protected Offline`，暂停恢复要求 `Protected Offline · retries paused`；两者由 `MenuBarProtectionStatus` 供给真实海景 Dashboard 标题。仅按公开 `accessibilityLabel` 或 String `accessibilityValue` 精确匹配，保留几何、像素、来源、超时及失败即拒绝检查。MacBook 未运行原生 XCTest；更正后的 hosted 执行仍待验证。

- 2026-10-06 续记：head965991d193/run37455171701 编译失败，AX 遍历误用 Swift 的 NSAccessibility 命名空间类型；SDK AppKit.apinotes 明确协议 Swift 名为 NSAccessibilityProtocol，现仅更正两处协议类型，所有来源/像素/内容/超时门槛不变。未本机原生构建，hosted 重跑待验。

- 2026-10-06 继续升级：Mac 默认关闭的海景外观已扩展到原生登录单栏/三段首次引导、紧凑线路列表/收藏筛选、活动当前连接与历史会话区分/最多20条展开、账户设备与真实配额条、单栏分组设置/完整隐私说明弹出、支持首屏健康检查/复制/明确预览后确认上传，以及原生侧栏与菜单栏静态地面/最多两条同账户目录快捷线路。旧外观分支和现有操作/保护守卫保留；原生线路点击仍按既有 selectNode 连接/重试，没有移植 Windows 的仅选择胶囊；Mac 仍用原生侧栏/窗口，不冒称 Windows 逐像素一致。新增加 51 个 zh/en key，原 833 个 catalog 条目未改（Home 原键为家宽，首页另用 sea.nav.home）。root 源码对照确认7类关键原调用仍在，3文件原长隐私/支持文案保留；diff check、JSON与0.0.75源码版本检查通过，不是原生执行。
- 2026-10-06 夹具续记：cd3df7d5/run37457325171 编译仍失败，Swift 导入的 NSAccessibilityProtocol 暴露 getter 方法；现调用 accessibilityLabel()/Value()/Identifier()/Frame()/Children()，不再把方法当属性。新增各页面真实视图的预选精确窗口采样，调用前给定标题/控件合同；原先两张blocked fixture合同保持，其余原离屏验收不变。新样本不按离屏结果择优，原生缺失/超时/内容缺失仍失败；保留离屏诊断、原生逐像素/几何/内容门槛及TXT/xcresult收据。登录夹具预置非生产auth-method数据；支持仅采实际首屏组件，未运行全页浏览器扫描或Helper探测，因此不声称全支持页截图通过。新增intro步骤、20条上限、收藏双传输身份、菜单两条身份上限各一个XCTest，未本机运行；新head hosted/图像/交互/真机仍待验。无Windows改动、无图标接线、无合并/签名包/安装/发布。
