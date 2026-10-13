| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SING-BOX-DIRECT-SIGNED-POLICY-BINDING | Windows Service 对 sing-box（与 mihomo）DIRECT 规则的准入只看形状，不接收、验证或比对签名流量策略：通过 App 身份门的请求可以把策略从未授权的域名/地址、或不在策略内的进程流量送往 DIRECT | open | [#1280](https://github.com/raydocs/tono/issues/1280)，本 PR（窄步）；决定 [110](../decisions/110-2026-10-13-sing-box-direct-admission-shape-limits.md) | 中·推导（P2） | 本 PR 只拒绝过宽形状（裸 `^`、`^.*`、短前缀、单标签域名）。完整修复需要：`ReplaceSingBoxRuntimeRequest` 携带策略与签名、Service 内置策略公钥与解码器、只放行策略列出的条目，并经 Windows 实机验证与协议版本升级；无修复 PR |
