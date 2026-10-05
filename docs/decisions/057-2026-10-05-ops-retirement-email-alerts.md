## 2026-10-05 · 旧 UI 退役是否仍须先配置 Telegram
- Status: provisional
- Chosen: 接续所有者“完成，直接用邮件就行，telegram 我后面再设”：两周日常使用与处理真实事故按所有者确认记录；本次通知渠道使用邮件，Telegram 延后，不再把 Telegram 配置作为旧 UI 退役的前置条件。邮件收件人由所有者在本会话明确提供，不写入仓库；现有 Resend 通道可复用，不新增第三方凭据。
- Why stricter: 不制造假事故或假告警收据，不把所有者确认当作机器可复查的历史证据。规则限定严重事故、15 分钟延迟与冷却；配置前导出 D1。邮件通道是否实际投递仍按数据库/provider 回执记录，不宣称收件箱已经收到。既有审查、CI、干净 main、合批审查与部署备份门禁不豁免。
- Applied in: [#1377](https://github.com/raydocs/tono/pull/1377) 退役续批；[收敛记录](../ops/console-consolidation-2026-10-04.md)。替代运维计划 §6 的 Telegram 专属前置条件，不改客户发布门。
