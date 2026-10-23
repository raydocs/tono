## 2026-10-22 · iOS 设置改为表单：首屏只放控件，说明下沉一级
- 归属：ops plan §P2 Android / iOS 客户端；iOS App 设置流（SettingsView、Routing rules 二级页、Licences 页、en/zh 文案、专用 UITests）。不推进 G4。
- 来源：基线 origin/main `a8d3c80c5` → 分支 `t3/ios-settings-redesign`，draft PR 见 PR 链接；尚未合 main。设计依据：2026-10-22 只读设计审计（设置首屏是解释而非设置；一种字重四种字号三种灰；文案重复、退出登录未分隔）。
- 缺陷修复：无客户运行时缺陷；属 UI/文案/可访问性。原首屏 AX5 下第一个真实控件（包含所有网络）被五行说明顶出屏幕；改后首屏第一组即 iOS 系统保护开关，AX5 无需滚动可见可点。
- 新增/优化：原生 inset-grouped List 配 Tono 烟色行面与发丝分隔；分组顺序 保护 → 路由（「路由规则」行尾显示生效模式，进唯一二级页：两种模式全文、识别范围、iPhone 平台说明、IPv6、合同摘要）→ 锁屏与小组件 → 账号 → 退出登录（独立组、唯一红色、保留确认）→ 许可与源码行 + 版本/内核小字脚注。三种角色：行标题 17、行尾值/控件、脚注 13。Connect On Demand 与「Tono 关闭时 iOS 不拦截」改为保护组常显脚注（原藏在折叠里），只去重不删除；删除 `system_include_all_desc`、`system_how_title`、`settings_about`、`settings_mode_unconfirmed` 四条已无引用的 iOS 文案。模式选择器与网址路由检查仍只在 Details；设置不复制。无「检查更新」/下载/TestFlight 行（分发未上线，不声称最新）。太阳色只在开关开态；红色只在退出登录。不改 AppModel、TunnelCommand、includeAllPending/未确认/确认行为。
- 工程与测试：新增 `apps/ios/UITests/SettingsUITests.swift` 三个用例：AX5 中英首屏保护开关在视口内且位于路由行之前；英文默认 规则页单一入口与「Change in Details.」、返回、两开关由整行翻转且包含所有网络显示下次连接生效、退出登录先确认且取消保留设置；中文默认 首屏/规则页/确认。用例同时把 default/AX5 首屏、规则页、确认截图写入 `TONO_SHOTS`。旧标识 `settingsModeWhere`（改到规则页脚注）、`scopeDisclosure`（改为 `routingScope`）、`liveActivityToggle`（改设在开关元素上）。
- 验证：本机不跑 Xcode/Swift（MacBook 规则）。云端 Devin macOS 结果（PR head SHA、SettingsUITests + 既有 sheets/largest-text 审计 + 对比扫描、截图目录）见本条续记与 PR 验证评论。
- 候选/发布：仅源码，无新候选；不合并、不 auto-merge、不部署、不监控。
- 剩余限制：真机 VoiceOver 朗读、触感与 120 Hz 未验；NavigationLink 行尾为系统 chevron，不随 Dynamic Type 放大；Android 设置页另一交付。
