| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-SELECTIVE-CLEANUP-RELEASED | A failed selective cleanup (resolver restore or route delete) still wrote the `released` tombstone, so start and the watchdog never retried and a leftover AI sinkhole stayed until another explicit Restore | in-PR | #1282 / #1283 | 低·推导 | a permanent cleanup failure (for example a corrupt receipt) now retries and logs on every 10 s watchdog pass while no Kill Switch intent is saved; ordinary network stays open |

Source: Codex gpt-6.1-sol high, post-merge review of #1222 (follow-up to #1169).

Open residual (Codex gpt-6.1-sol high review of #1283 at `094f49dc`, minor, recorded open under the stop rule): SelectiveFailOpen.swift:408–411,419–423 — the directory-safety check failing returns `true`, and a receipt `lstat` error other than ENOENT does not set `removed = false`, so "could not safely clean" is still recorded as released and never retried.
