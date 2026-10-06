## 2026-10-06 · Windows 新外观 PR 8：活动与账户
- 归属：`docs/SHIP_PLAN.md` 0.0.75 UI，ROUND-3 §10；默认关闭，stacked on #1410。
- 来源：`3be3709c` → 本 PR head；`codex/windows-ui-pr8-20261006`，未合 main。
- 缺陷修复：无已发布产品缺陷；未知账户不伪造套餐/有效期，保留未知占位。
- 新增/优化：50px应用组、150px路由分布条、当前应用/连接摘要、展开最多20条连接；搜索、拒绝筛选、本机DNS隐藏、完整线路说明与所有证据 caveat、逐条关闭/关闭全部原 generation guard 保留。账户单面板含邮箱/套餐有效期/6px流量条/设备/移除和退出；两个原确认共用且动作与账户scope不变。
- 工程与测试：只新增 opt-in presenter/CSS；旧外观原 JSX/动作保留。独立回归证明20条上限及原generation关闭一次、未知账户不显示无到期/流量。合成fixture填充全部路由及两台设备，无本机诊断/账号/连接 IO。
- 验证：MacBook 前端最小2files24tests PASS；full54files370tests PASS；typecheck79/baseline79；ESLint0warnings；Vite1.06s。新文件Biome通过及最终checks、EgoTaskSpace23截图在PR comment；旧Activity/确认对话框的原有Biome告警未顺手改写。
- 候选/发布：仅源码，无新包、签名、安装、客户发布。
- 剩余限制：已知应用图标无现成可信资产，当前均用首字母tile，未伪造品牌图标；真实遥测、Windows WebView、硬件及完整视觉/性能验收未完成。当前摘要不冒充整个会话累计统计。旧扁平连接视图入口在新外观改为逐应用展开，原关闭/解释动作都保留。
