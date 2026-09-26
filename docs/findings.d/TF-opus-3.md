| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| TF-opus-3 | 停用后不重启 Xray 就重新启用，`shared-legacy` 仍被撤、只有 `u:*` 恢复 | in-PR | [#600](https://github.com/raydocs/tono/issues/600)，[#638](https://github.com/raydocs/tono/pull/638) | 低·已确认 | 按 Issue 定为流程修复：停用轮日志与 README 写明立即停 `tono-xray`、重新启用时再启动（重启才从静态配置恢复 `shared-legacy`）；agent 不自动停启 Xray；需部署到节点 |
