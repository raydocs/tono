| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SOL-CP-DIAGNOSTICS-PARTIAL | 诊断包未完成校验即落库，后续错误返回失败但前半数据已提交 | fixed(c303c534) | hunt/sol-cp-diagnostic-bundle-atomic | P2·已复现 | 不实现追加记录重试幂等；故障聚类仍为派生 best-effort 写入 |

All six bounded sections are now validated and prepared before one D1 batch. Cluster updates run only after a successful commit, with individual failures logged without rejecting the already-stored upload. Two narrow regressions fail on original source: invalid second hop leaves session/hop rows behind; unavailable cluster storage rejects an upload whose failure event was already stored. Both pass after the fix.
