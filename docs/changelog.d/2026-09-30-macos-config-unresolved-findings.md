## 2026-09-30 · macOS 配置深审的两个未修复交叉状态问题
- 归属：SHIP_PLAN §2 item 10；M9 配置、托管策略与助手服务保护。
- 来源：main `1fb29265`；分支 `hunt/sol-r3cfg-unresolved-config-findings`；只新增发现记录，未修改产品。
- 缺陷修复：无。记录网页钉选刷新被后缀存在性误关闭（P2）及专属模型 API 的 DIRECT 排除遗漏（P1）。
- 新增/优化：无。两项都需要协调方案，不能把局部网站故障换成已记录的全会话重载中断，也不能为兼容旧签名后缀放松受保护域名拒绝。
- 工程与测试：无产品或测试改动；保留两个独立只读审查的调用链、核心拨号语义及官方模型 API 文档证据。
- 验证：Linux 只读源常量复核确认专属 API 不在助手/排除集合、却处于产品网页 DIRECT 服务树；不是 Swift 发出器执行或实机复现。已复核固定 sing-box 核心 resolve→DestinationAddresses→拨号路径。`git diff --check` 及 records 两条发现读取通过。
- 候选/发布：仅记录，无新候选。
- 剩余限制：两项仍 open；Swift/Xcode、PF/DNS、真实 CDN 地址轮换和实际代理调用未执行。helper、Windows 及签名策略发布均未修改，不部署或发布。
