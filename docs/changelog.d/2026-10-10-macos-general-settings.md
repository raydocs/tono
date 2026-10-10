## 2026-10-10 · macOS 常规设置的生效说明与 Login Items 回执
- 归属：SHIP_PLAN G2；有限 UIUX 2/3/4 的 Mac 设置项，不是完整候选包验收。
- 来源：main `45fd254c` → `amp/macos-settings-feedback`；PR/head 与准确 CI 结果在交付时补记。
- 缺陷修复：Login Items 的 pending/error 不再随页面卸载丢失；模糊失败不显示 Saved，要求显式读取系统状态后再试。
- 新增/优化：界面语言提前披露重开及连接/网络保护解除代价；登录项说明下次 macOS 登录生效、不影响当前连接；等待批准时提供打开登录项、刷新及关闭请求的动作；技术错误渐进收纳，经典模式控件不再使用空/错误的无障碍标签。
- 保留边界：现有 SMAppService API、默认值/键和写回系统实际状态的方式保留；语言受保护确认条件、AppSettings/AppState/helper/PF、A29 的局域网三个修改点、主页/连接页未修改。保存锁迁到设置页共享 UI 状态，须独立精确 head 生命周期评审。
- 工程与测试：在既有 MacUsabilityRenderTests 增加一条异步回执回归及生产 SettingsView 的 normal/approval/saving/error/saved/unavailable/中文窄窗/经典渲染；只替换 Login Items IO，用一次性 defaults，不操作宿主登录项。
- 验证：Linux 不执行 xcodebuild/Swift；结构/翻译检查与 hosted macos-26 的编译、XCTest、窗口截图分别记录，不以结构检查替代运行结果。
- 候选/发布：仅源码，无新候选、无更新源或发布操作。
- 剩余限制：真实 macOS Login Items 批准/取消、失去回执、VoiceOver/全键盘控制、语言重开与保护释放需要最终原生设备包验收；此处合成 IO 的原生窗口截图不代表这些检查已通过。
