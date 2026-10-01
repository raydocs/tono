| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| PROVISION-ROLLBACK-MODE | Transaction rollback copies a snapshot's read-only mode onto the restored live file and then rejects its own restoration | in-PR | hunt/sol-r3ops-rollback-file-mode | 低·已确认（P2，Linux 回归） | Service read permission survives; no node outage claimed. Native VPS rollback not exercised. |

`backup` records original modes, then removes snapshot write bits. `restore_one` previously preserved the changed snapshot mode. Restore the recorded mode for non-symlinks; symlink targets remain untouched, and snapshots remain read-only with their hashes checked.
