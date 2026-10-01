| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SOL-CP-LOG-RENEW-SWEEP | 过期清扫用旧 SELECT 结果删除已续期的原始诊断日志授权并误记关闭审计 | in-PR | hunt/sol-cp-log-window-renewal-fence | P2·已复现 | 窄续期/清扫重叠；保持既有 expires_at 小于当前时间边界 |

The cleanup DELETE rechecks expiry atomically, and its immediately following audit INSERT requires one deleted row. One barrier regression renews a selected grant through the real ops API before the cleanup batch, then checks the renewed grant remains and only the genuinely expired grant is removed/audited. Before the fix both grants are deleted.
