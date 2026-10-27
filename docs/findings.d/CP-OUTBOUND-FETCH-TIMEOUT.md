| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-OUTBOUND-FETCH-TIMEOUT | 控制面若干外呼 `fetch` 没有超时：失败聚类 webhook（在客户 `POST /telemetry/failures` 内 await）、Apple/Google OIDC 公钥（登录缓存未命中时）、ops Access 公钥、Tailscale API（五分钟 cron 在撤销前列 tailnet）；对端卡住时客户上传或登录一直挂着，或整轮 cron 卡住 | fixed(a880f0aac) | [#1776](https://github.com/raydocs/tono/pull/1776) | 中·已确认（webhook 有红测；其余读码） | webhook/OIDC/Access 5 s、Tailscale 10 s；邮件发送（Resend）在 `waitUntil` 里且带幂等键，超时后会把可能已送达的验证码作废，故不加 |
