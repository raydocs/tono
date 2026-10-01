| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-SELECTIVE-CLEANUP-RELEASED | A failed selective cleanup (resolver restore or route delete) still wrote the `released` tombstone, so start and the watchdog never retried and a leftover AI sinkhole stayed until another explicit Restore | in-PR | #1282 / fix/selective-cleanup-released-retry | 低·推导 | a permanent cleanup failure (for example a corrupt receipt) now retries and logs on every 10 s watchdog pass while no Kill Switch intent is saved; ordinary network stays open |

Source: Codex gpt-6.1-sol high, post-merge review of #1222 (follow-up to #1169).
