## 2026-10-06 · Windows 新外观 PR 9：支持与设置
- 归属：`docs/SHIP_PLAN.md` 0.0.75 UI，ROUND-3 §11；stacked on #1411，默认关闭，未合 main。
- 来源：`4b604480` → 本 PR head，`codex/windows-ui-pr9-20261006`。
- 缺陷修复：无已发布产品缺陷；不得把“已观测”改写为全网健康/保护已验证。
- 新增/优化：健康检查/复制给客服/上传诊断三动作一排；健康观察结果保留原逐项解释与unknown/current判定，两个原工具折叠面板，完整系统摘要/日志/构建身份/复制诊断在技术详情。设置通用/外观/隐私/关于四组；默认关闭的新外观开关、Auto/Full/Lite/Static本机存储、开启新外观时隐藏主题；隐私简述显式说明数据类别，原完整说明逐字保留Popover；日志路径和原复制动作移到关于。
- 工程与测试：只组合原presenter/按钮和同一原handler，所有原上传冻结preview→明确同意→receipt、修复确认、generation/account-scope/证据过期、偏好回滚、更新availability/error条件不变。Shared SupportContact新增compact仅省去重复容器，原复制内容不变。关闭外观后原页面布局/动作保留，设置仅多一个预览控制面板。
- 验证：MacBook narrow2files18tests/full55files372tests PASS；typecheck79/baseline79；ESLint0warnings；新文件Biome6filesPASS；Vite793ms。EgoTaskSpace23 synthetic-only实测Full→Static：存储和真实scene data-quality均static；开关off恢复主题行/无scene，on隐藏主题；完整隐私Popover、三个显式支持动作、健康unknown/observed与折叠技术详情已截图。
- 候选/发布：仅源码，无新候选、签名、安装或客户发布。
- 剩余限制：Windows真实WebView、系统切换/帧率和完整mock矩阵未验收；支持fixture只读合成报告，不是本机保护证据。保留既有unsigned文案（未在UI PR伪造签名结论），签名候选里的条件性版本说明需release-trust独立覆盖后再处理；privacy说明/同意流程的合并前覆盖仍未声称完成。
