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

- 2026-10-06 协作评审续修 M1–M8：首页新模式去掉旧连接状态胶囊和右上日月符号，只保留统一状态标题/说明、既有 Connect/Disconnect/Restore 入口及线路芯片；连接/恢复异常保留原进度卡和全部恢复动作，不以平静布局隐藏它们。标题采用跨端词表，保护未知优先，重试暂停继续由原恢复反馈说明；连接取消仍保留1.2秒双击宽限。平静态的原节点卡、完整路由推荐操作、概览和网络资料移入可关闭的原生详情 sheet，不改变数值或目录身份。海景自设深色，节点文字显式浅色、动作暖渐变深字/次级冷色；旧外观仍默认关闭并保留。
- 2026-10-06 场景续修：静态天空与水面共用同一地平线色，移除旧色带；加入柔边日轮及双光晕、裁切在水面的渐宽渐淡日月倒影列，月牙改透明遮罩；夜景保留靛蓝。二级页统一近黑梯度和不承载连接状态的低暖光；降低透明度/增强对比度隐藏装饰，原 phase resolver 与动效开关不变，无帧循环/新依赖/图标接线。新增一个地平线连续性 XCTest 与一个未知优先状态词 XCTest，MacBook未运行原生。八项产品发现记入 I-UI0075-M1–M8，状态 in-PR，不把协作意见视为 owner 验收。
- 2026-10-06 hosted 结果：5ce635ed/run37459389672 产品和测试已编译；全套 XCTest 失败于新窗口夹具 AX 仅读到根节点（AX[1]）以及账户/设置少数透明像素，非原生视觉通过。日志、PNG/TXT保留，正在有边界地修夹具，绝不跳过来源/内容/不透明度检查。新夹具预先指定 darkAqua/深色环境，并对标题区域要求浅色像素（其他内容仍要求几何/像素对比度），旧关闭外观保留 light/Aqua。当前修正的编译、PNG与真机仍未验，无合并/签名/安装/客户发布。

- 2026-10-06 夹具修正与画面复核：root 逐张查看5ce的线路、账户、设置、活动、支持首屏、登录、引导和菜单8张真实组件/页面原生PNG；活动历史流量提示被单行布局省略，已允许完整换行；支持首屏原生 borderedProminent 在非活跃窗口丢失暖填充，改用既有 GateProminentButtonStyle 的小号海景暖动作，调用/上传确认不变。窗口夹具从自身NSWindow及host遍历公开AX，保留真正role元素与legacy属性桥接（SDK Swift typed attributes），unsupported/超限仍失败；设置真实窗口 opaque backing，不改捕获像素或ScreenCaptureKit填充。账户/设置旧图各仅2像素alpha252，其余255，明确配置后是否解决仍待hosted，不放宽全图不透明断言。

- 2026-10-06 SDK 续核：NSAccessibilityElement 的 identifier 是 @optional 方法（SDK NSAccessibilityProtocols.h:24–27），role 协议调用加方法可选链 `accessibilityIdentifier?()`；全协议必选调用不变。此为源码/API更正，未冒称原生编译通过。

- 2026-10-06 状态词源码续核：旧 MenuBar.kind 可在 isConnected=false 时仍为 degraded，新词映射因此额外要求实际 isConnected 才显示 Connected；未知仍优先，已无连接的残留 degraded 只说 Not connected。不改原 status model/FSM/动作，新增一个窄投影回归（未本机运行），避免外观映射凭单独 degraded 标志误宣告连接成功。

- 2026-10-06 同类投影续核：旧 kind.blocked 也用于 Waiting to retry，并非独自证明屏障；海景 Protected, not connected 额外要求实际 isProtectionBlocked 且未知标志不成立，否则说 Not connected/Protection status unconfirmed。新增一个无屏障重试 kind 的窄回归，原 FSM 与屏障读回仍不动；hosted 待验。

- 2026-10-06 M5/M8 最后源码对照：菜单忙碌圆点新模式改冷色；报告确认动作新模式暖填充（关时保留原 native prominence）。状态映射输出资源 key，由真实 Text/SwiftUI locale 本地化，避免 Foundation 当前 locale 覆盖视图语言；新增仅海景 Connecting=连接中、Disconnecting=断开中两键，旧正在连接/正在断开译文保持。新增一个忙碌词表 key 回归，原生待hosted。

- 2026-10-06 exact81e2d7c6/run37462290756：产品与测试原生编译通过；LocalizationCoverage 报新 Disconnect 缺zh-Hans，现补真实断开动作译文；native截图内容/少数alpha不足仍失败，窗口 backing 修正未解决，已保留原始新图/收据，下一步只审定该夹具证据策略，不跳过图像断言或包装成UI通过。

- 2026-10-06 第二轮协作 MAC-REVIEW-2（不是owner验收）已读；root查看81e2确认连接/暂停恢复原生图及场景图：首页层级和浅字已可见，装饰路径尚无图证明、旧水色仍成光带、日轮遮罩边缘锯齿。M3继续in-PR，将用可注入只读装饰覆盖出开/关对照，按真实Windows源码撤回先前water==sky模型。首页芯片改静态相位点/真实线路，未知延迟省略（线路页Not tested不变）；菜单海景去重复月亮符号，原native状态项不动。首页“断线不漏IP”新保证文案暂未新增，保留当前事实型说明，协作建议不作为owner授权或安全证明。

- 2026-10-06 M3/R1–R3 源码续修：加入只读 seaDecorationsOverride（nil仍尊重生产降低透明度/对比度），渲染明确输出夜/日/阻断装饰开关六图并增加真实首页装饰版；水面改独立深色底按相位着色并渐淡，第一色不再沿用sky末端；夜色为可辨靛蓝地平线，旧同色断言按被撤回的建议删除，改真实水面组合比天空暗的一个回归。日轮改普通Circle加装饰态柔边副本，短椭圆地平光代替全幅色带；无持续渲染/偏好写入/状态变化。source数学与diff检查通过，native图仍待新head。
- 2026-10-06 原生证据裁定：只读arbiter据81e2的真实PNG/TXT确认SwiftUI托管AX只到HostingScrollView，不能靠再猜API证明画面；改用预选同一精确窗口原图的Vision英文文字/布局/对比度证据，捕获前记录并要求process与app-bundle英文。原AX保留诊断，绝不宣称动作、AX语义或恢复identifier通过；暂停态以真实app.recoveryFeedback完整可见文本作视觉证据。线路星号的Remove favorite本是不可见AX标签，不可用OCR冒充；视觉合同用真实Favorites/Paris行，原AX标签仍单独诊断未验。所有原图逐像素alpha1门槛保持，少数fractionalpixel继续使CI失败；增加真实window背景/不透明度、原CG/PNG/邻域与一次同来源重复捕获、ImageIO诊断，后者绝不择优替换原图。本机不跑原生，不以这些源码更改宣布绿色或UI/G1/G2验收。

- 2026-10-06 exactde606/run37467832621：产品/测试编译、本地化覆盖、海景水色回归、四条状态词与原两张blocked原生文字/反馈/全图alpha门槛通过；root实际查看装饰开关六图及真实首页装饰图，已看见星点、光晕、纵向倒影、深水硬地平线与平滑日轮，仍不是owner/真机验收。二级页账户2个alpha252、活动1个alpha254在原CG、NSBitmap、ImageIO和同源重复中完全一致，故非PNG编码器单独问题，仍失败。随后设置页公开AX导航顺序的NSArray导入窄类型桥接触发Fatal（Expected NSAccessibilityElement / actual NSAccessibilitySegment），后续四页未完整执行；现诊断仅走SDK无泛型限制的accessibilityChildren，不再枚举重复的导航顺序数组，AX仍未验。Vision优先最少匹配行，避免短按钮被无关多行几何包围；第一图/文字/完整反馈/全像素alpha断言保持，无本机原生执行。

- 2026-10-06 原生截图合同纠正（非产品修复/非测试通过）：只读arbiter28259完成新原CG/PNG/重复图审定，原“全部alpha255”不足以代表独立窗口完整画面；Apple SCStreamConfiguration.shouldBeOpaque默认false支持可保留半透明，但具体合成层仍未证明。按原图证据，仅新增二级页明确采用通用孤立栅格边缘合同：像素必须内点、八邻域全不透明、最坏底色贡献≤5/255、RGB与至少一个不透明同填色邻点每通道差≤2/255；边界/alpha0/相邻空洞/缺失邻点/变色/无效数值拒绝。原两张blocked首页严格alpha1不变；所有截图仍第一预选原图、保留完整OCR/尺寸/内容/来源/字节/超时门槛，不设opaque捕获、不涂像素、不裁切、不择优、不按fixture坐标特判。一个窄XCTest含正例与各拒绝对照已写，MacBook未执行；hosted验证与后四页新图待验，原de606红色不改写。

- 2026-10-06 exactbf22/run37500418893：原生编译通过，孤立边缘合同正/拒绝对照XCTest通过；AX不再崩溃，原两张Dashboard和二级页7张原图几何/完整性/文字合同通过（10张中9张）。唯一失败为intro第一屏，原PNG与源码正确写Illustration，未校正Vision给Illlustration（额外l）；root已看实际图，原始错误OCR收据保留。按SDK VNRecognizeTextRequest.h67的通用语言校正（关闭会降低准确性）启用英文识别校正，所有图片一视同仁，仍逐句精确匹配、无自定义expected字典/错字替换/模糊匹配/跳过caption，也不修改产品正确文案来过测。当前更正仅工程夹具，hosted尚待跑，bf22仍red。MAC-ALPHA-NOTE的测量与原图一致，明确底色已在窗口/SwiftUI root/Mesh存在；host层为空仅作未证实线索，不称真实应用缺底色已修。

- 2026-10-06 默认开启与绿后细修续记：协作会话ribboneel转述owner“全面大升级 稳定性流畅性和美学”与“授权你合并 新外观开”；已读取其[provisional决策065 / #1416](https://github.com/raydocs/tono/pull/1416)，本Mac PR只落实展示偏好，未把转述视为G1/G2、实机或发布证据。未设置seaAppearanceEnabled时统一defaultEnabled=true；5处AppStorage读点一致，已存false/true保留，不做强制迁移、不删除偏好；设置保留开关、名称由预览改海景外观（新zh/en key，旧890条不改）。新增真实AppStorage隔离suite的一个默认开/显式关闭/重启保留回归，MacBook未跑原生。
- 2026-10-06 美学/可读性续修：引导说明由caption升callout并允许完整换行，不改安全事实文案；日月倒影广光由被Ellipse裁切的径向填色改为内侧85%半径已透明的缩放径向场，外缘/两侧无路径截断，纵向glints与可达水面裁切保留；二级SeaPanel、登录和引导统一中性偏暖的实色/渐变panel token，增强对比/降低透明度仍实底无live glass。源状态解析、动效策略、原处理器/旧外观分支不动，无Core/helper/PF/连接/账号生命周期/依赖/帧循环/Windows改动。
- 2026-10-06 基线验真：91d2/run37502578021已green，raw617tests/1skipped/0failures与10原生窗口合同通过，新默认开/细修不沿用为已验；仍需新head hosted与装饰/无装饰、原生页面PNG审阅。完成后冻结最终SHA交Claude独立评审/按条件合并；不触碰正在评审的Windows栈，不在本轮自动合并、签名、替换应用或推进客户源。

- 2026-10-06 只提供新外观续修：[provisional068](../decisions/068-2026-10-06-macos-sea-appearance-only.md)记录 ribboneel 再转述 owner「和合并的全都合并到 main 只用新外观就好了」。Mac 设置外观开关移除，5个实际读点共用只读 SeaAppearancePreference；生产 nil override 恒为新外观，不读取/删除/重写旧 off。动效偏好/系统无障碍保留，旧界面仅夹具可达留待专门清理，未动 Windows 栈或将转述当成 G1/G2。
- 2026-10-06 review3cdd 单轮：root复核 unconfirmed+failure 主窗口恢复入口丢失及快捷键缺失；现在 sea 页首真实主按钮常驻，未确认/不可读/阻断显式 Restore internet，连接中 Cancel/断开中禁用/原1.2s取消宽限和处理器不变；ConnectionProgressCard仅抑制页首已提供的重复动作，保护态重试/修复、未知态重试与换线路/备份保留。共用 ConnectPillKeyboardShortcut，不加隐藏按钮或全局副作用。新增存off+无override的真实生产首页原生回归和 unconfirmed+failure 恢复入口原生回归，各一个；旧 opt-out AppStorage 测试因新政策失效已替换，shortcut真实映射一个回归。原生未本机运行，不推断旧代码已跑红。
- 2026-10-06 review3cdd 目录：保留原完整 Hide details 条目，删除本PR新增的相同重复前缀；两句实际 Settings/Activity 读点补 zh/en，891旧逻辑条目均不改，新增2；现有通用文案扫描加入 SeaPageHeading。工程项重复JSON键/旧默认测试覆盖缺陷记本记录与PR限制，不进产品账；产品发现新增分片，F1/F3/F5在PR、F2反驳、F6四档实际两组保持open，按minor stop rule不冒充已修。
- 2026-10-06 评审范围：协作者提供91d2/3cdd PASSED报告，root未把它当成本轮最终head独立评审；协作者已追加f2bf/8e366 PASSED/7minor/无阻断报告，仍不是当前新增量评审。本轮 source/新原生测试及PNG须新ci-gate，最终SHA交Claude只复审新增量；不自动合并、签名、安装或推进客户源，旧红图与日志保留。

- 2026-10-06 同一轮追加8e366两项：Support 的所有保护摘要先用真实 appState unconfirmed/unreadable 覆盖残留 snapshot；未知不拼接未确认 Kill Switch/TUN 事实，一个真实快照投影回归。菜单栏推荐按钮保存完整 proposal 并打开原确认文案，确认才调用既有 confirmRouteRecommendation；取消不拨号，过期/跨账户拒绝复用原函数和提示。手动收藏仍走已有手动选择路径，不声称整张菜单的所有线路改为推荐。新 menu action 捕获+目录变化拒绝一个回归；本轮没有 Core、Services 或准入/选择语义改动，确认UI增量仍须独立审阅。
- 2026-10-06 其余minor：菜单栏degraded保留Connected会话标题但补已有出口检查/恢复说明，新增一个原生PNG回归；Activity展开连接计数实时分支显式String(localized:)沿用既有%lld中文资源。两项新产品分片in-PR；重复缺中文/动效问题归并既有R3条目，四档两行为仍open。所有新增原生/单元回归本机NOTRUN，等待本轮唯一最终head hosted，不冒充真机/按键/弹窗事件验收。

- 2026-10-06 页首取消补全：重读移走重复 Cancel 后的初始连接态，Dashboard 首次出现若已在 connecting，补记 connectingSince（仍1.2s保守宽限），避免等待不到 onChange 而永远不能取消；不改变 seaToggleConnection 原处理器或特权释放。此为同轮 source 集成修正，新最终 head 替代2aff，未将其在途CI称通过。

- 2026-10-06 最后单点 minor：协作增量评审 1e556431 覆盖 f2bf4149..155815e7，报告 PASSED/无阻断（不是 owner 验收）。opus:F2 确认移除外观开关后旧 Theme 行不可达，主窗口和 MenuBarExtra 却仍读取已存 themeMode；现删除应用入口的该读取，两处共用固定 dark 海景 scheme，不删除或改写旧值，旧夹具设置行保留待专门清理。新增一个实际 AppProfile Light/Dark 存值不影响生产 scheme 且值不变的 XCTest，MacBook 未运行；新最终 head hosted 仍待验证。四档动效 I-UI0075-R3-O-F6 保持 open，无其他源码续改。
- 2026-10-06 评审证据限制：菜单 proposal 回归没有运行旧代码红灯，不声称它证明旧实现必失败；真实 MenuBarExtra 确认弹窗/焦点/按键/AX 和 owner 实机仍未验。155815e7 的 hosted 原始日志为 622 tests/1 skipped/0 failures、13 原生窗口合同通过；该结果是主题单点修复前的基线，不冒称新 head CI 已绿。

- 2026-10-06 主题回归验真与最新 main 集成：8596a593/run37515683280 exact-head ci-gate SUCCESS，raw `testProductionSchemeIgnoresStoredThemeWithoutOverwritingIt passed (0.039 seconds)` 与 623 tests/1 skipped/0 failures；不是安装/签名/owner 证据。按 ribboneel 新请求合入 main5a77c6b681b694c4174acf1dffd43368e0d49471（Windows #1417），自动无冲突；相对上一 hosted 主线基线 c7d77517 的新增仅 Windows/docs，未再次改 Mac 产品代码或做合并解决，HelperProtocolVersion 同一 blob、无版本碰撞，不人为升级。Windows 使用既有 main 树不另修改；068 保留，无旧063-windows文件链接或新决策号。复用已记录的 Mac 评审范围及本轮主题单点修复，不重审全栈；集成 head 的 hosted/原图须重新通过，不沿用8596绿灯。
