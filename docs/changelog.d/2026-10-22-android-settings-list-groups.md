## 2026-10-22 · Android 设置页重组：列表分组、模式选择与网址检查移入详情
- 归属：ops plan §P2 Android / iOS 客户端；独立 draft，不推进 G4，不涉及 G1–G3。
- 来源：main `a8d3c80c5` → 产品源码 `6f69e6b28`，加测试/文案修正到 `2bb5773d6`（`t3/mobile-settings-details-ui`，wip 镜像 `wip/android-settings-groups`）；draft PR 见 PR 头；尚未合 main。
- 缺陷修复：无客户运行时缺陷；本次为导航、排版与文案。
- 新增/优化：设置首屏只剩可改与身份项，按 Material 3 列表分组放在 Night 上：保护（打开 Android VPN 设置
  外链行 + 原「始终开启状态未确认」诚实脚注，不新造状态）、路由（「路由规则」行以当前模式为值，
  「不经过 Tono 的应用」行以数量为值）、账号（已登录地址）、退出登录单独分组并加确认对话框、底部版权
  行与「许可证与源代码」。模式选择改为详情页里紧邻流量去向的分段控件，网址检查也移到详情；规则长说明
  （识别范围、平台规则、IPv6、路由合同）只在二级页「路由规则」出现一次。去重复：about_test、
  routing_platform 里的排除应用句改为路由分组脚注。颜色：日光色只标选中态，红色只用于退出登录。
  不加「检查更新 / 下载 / 已最新」任何入口：尚无真实更新链。安全边界提示（始终开启未确认、绕过应用
  含 AI、命中流量失败即暂停）保留，仅去重复。不改 engine、路由、凭证或排除保存逻辑。
- 工程与测试：新增 `SettingsFlowTest`（首屏首个可点行为 VPN 设置、首屏无模式单选与检查框、路由规则页
  进出、退出登录取消不发命令/确认发 `signOut`、详情分段控件发 `setMode:STABLE`、网址检查调用 explain 并
  显示判定）；`AccessibilityContractTest` 的 48 dp/标签/2.0 字号/中文遍历增加路由规则页与确认对话框；
  JVM 渲染增加 zh 规则页、zh 2.0 首屏、en 首屏 1.0/2.0、规则页、确认框、详情分段控件；设备测试在点
  「退出登录」后点确认按钮（contentDescription `a11y_confirm_sign_out`），应用行改按标题定位。
- 验证：Devin Linux（Pixel 6 API 34 x86_64 模拟器，JDK 17，SDK 36，libbox 钉死哈希一致），精确 checkout `2bb5773d6`，
  session `22434b29263f4ab9974ce423cac4e3eb`，本机运行目录 `~/.local/state/devin-cloud/runs/20261022-214058-linux-2bb5773d6`：
  CI 构建命令 BUILD SUCCESSFUL；mobile JVM 138 发现 / 106 通过 / 32 为 `-Ptono.screenshots` 可选跳过 / 0 失败，
  routing 18/18；lint 0 错误（29 条既有 UnusedResources 警告，触及的 Kotlin 文件 0 条）；`ScreenshotRender` 17/17、
  `UiRevisionRender` 13/13 实际执行；模拟器 `DeviceEvidenceTest#b1/#b4`、`HorizonUiDeviceTest#u1/#u7/#u9`、
  `LargeTextDeviceTest#l1`、`SmallScreenDeviceTest#l2`、`LandscapeDeviceTest#l3` 全部 OK。截图（en/zh，1.0/2.0，首屏、
  列表末、路由规则、确认框、详情分段控件与检查框）由 director-fable 读图：无截断、无重叠、颜色符合规则；2.0 首屏可见
  「打开 VPN 设置」行。前三轮（`6f69e6b28`、`8182f3801`）失败为测试侧：`onAllNodes` 误 import、fixture 标记检查不识别
  对话框 60% 变暗；第三轮在共享 session 被另一分支（`wip/android-settings-layout`，`678116799`）的请求顶替，未跑 `1e820f5ab`。
  Red check 未跑：新测试引用新签名，在旧代码上是编译失败而非红。本机 MacBook 不跑 Gradle/模拟器。
- 候选/发布：仅源码，无新 APK、签名或发布。
- 剩余限制：实机 TalkBack、触感、OEM 皮肤、always-on/lockdown 行为未验；iOS 侧对应重组不在本 PR。详情页 2.0 字号下
  分段控件与检查框在车道之下需滚动（保持 iOS 顺序，面板可滚）；2.0 字号车道状态点换行为既有 `Lane` 代码。
  并行分支 `wip/android-settings-layout`（`678116799`，基于本 PR 的 `6f69e6b28`）另加底部渐隐带与对话框 45% 变暗，
  并使用同名 changelog 文件，需父任务择一合并。
