| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| PROVISION-ROLLBACK-MODE | Transaction rollback copies a snapshot's read-only mode onto the restored live file and then rejects its own restoration | fixed(857b9e73a9231340145ec88aa19c6f2fefbfaa78) | [#997](https://github.com/raydocs/tono/pull/997) | 低·已确认（P2，Linux 回归） | Service read permission survives; no node outage claimed. Native VPS rollback not exercised. |

`backup` records original modes, then removes snapshot write bits. `restore_one` previously preserved the changed snapshot mode. Restore the recorded mode for non-symlinks; symlink targets remain untouched, and snapshots remain read-only with their hashes checked.

Merged source passed required CI; needs-hardware remains for separately authorized real exit-node restart/rollback acceptance. No real-host operation was performed by this hunt.
