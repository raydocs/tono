| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-COMMITTED-CLEANUP-RETRY | A transient committed-artifact deletion error retires the update retry task and leaves old backup bytes that block a later update | fixed(9e4a8447) | This PR | 低·推导 (P2) | Native sharing-violation regression authored; Windows CI and installed update validation pending |

`cleanup_committed` called the manual replacement's best-effort `cleanup`, which logs deletion errors without returning them. `finish_committed` therefore retired the SYSTEM ONSTART task after an ordinary reader denied delete sharing on a `.rollback` file. Committed attempts are no longer pending, so Service startup does not otherwise spawn recovery. The retained old backup differs from the newly installed target and is intentionally refused by future replacement preparation.

Committed native cleanup now propagates artifact removal errors before task retirement. The next boot can retry the committed branch, including artifacts already removed by the first pass. Manual installer cleanup stays best-effort. No network policy, update proof, pending recovery, target bytes or strict-mode behavior changes.
