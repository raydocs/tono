## 2026-10-05 · 并行任务建立同收件人的两条邮件规则时保留哪一条
- Status: provisional
- Chosen: 只停用本任务后建的 `ops-email-owner-20261005`，保留较早已启用且同一 owner 指定收件人的 `2dd81896-28cb-4cbc-b332-9ff7fa0631f0`，不修改/删除其他任务的规则。仅一条启用规则；真实投递和 system 审计记录保留。通知仍使用邮件，Telegram 后补。
- Why stricter: 避免严重事故重复发送两封，不接管其他任务的配置，不为了制造测试证据新建假事故或重发已投递消息。所有写入在本任务D1导出之后，recipient相等与规则启用状态先只读核对；更新有对应系统审计。较早规则为 warn/open、0秒延迟、3600秒冷却，不把先前较严格规则的参数冒称最终配置。
- Applied in: [退役部署记录](../changelog.d/2026-10-05-ops1-retirement-deploy.md)；已在 [#1388 评论](https://github.com/raydocs/tono/pull/1388#issuecomment-6000263983) 通知并行交付方。不读取/打印 Resend API key，收件地址不入仓库。
