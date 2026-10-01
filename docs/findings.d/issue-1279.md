| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| issue-1279 | Windows sing-box DIRECT 准入只认 `type: direct` 出站，可选到 `Tono-China-Direct` 的 selector 让 AI 域名规则绕过准入走物理网卡 | in-PR | [#1279](https://github.com/raydocs/tono/issues/1279), [#1281](https://github.com/raydocs/tono/pull/1281) | 高·推导 | 需实机验证 WFP 审核端口放行期间的行为 |

来源：#1248 合并后的 Codex（gpt-6.1-sol, high）复核。修复把 DIRECT 标签集合按 `outbounds` 成员与 `default` 传递闭包（含嵌套与环），通向 DIRECT 的组也按 DIRECT 规则形状准入。needs real-hardware testing。
