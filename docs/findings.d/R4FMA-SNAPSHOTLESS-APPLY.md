| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FMA-SNAPSHOTLESS-APPLY | Snapshotless macOS DNS restore retry skips activation after Commit succeeds and Apply fails | fixed(d3a38043) | [#1063](https://github.com/raydocs/tono/issues/1063) | 中·已确认 | P2: snapshot loss/corruption plus Apply failure. Snapshotless success now requires Apply-only of persisted settings; native CI/hardware pending. Apply is asynchronous; update active-state verification remains separate. |

Baseline `f199567d`: `ProtectedDNSManager.swift:356` skips already-empty persisted DNS and `:375` returns success although the prior failed Apply left active loopback. The new retry neither writes foreign custom lists nor commits unrelated settings. Existing nonblocking SCPreferences locking and valid-snapshot retries remain intact.
