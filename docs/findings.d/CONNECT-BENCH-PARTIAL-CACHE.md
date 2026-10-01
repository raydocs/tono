| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CONNECT-BENCH-PARTIAL-CACHE | Interrupted benchmark extraction leaves a partial executable cache that retries trust by existence; existing outputs also override a newly checked pin | in-PR | hunt/sol-r3ops-bench-cache-publication | 低·已确认（P2，Linux 回归） | Local benchmark tooling only; no customer runtime binary admission, routes or DNS changed. Full benchmark remains hosted CI. |

Every benchmark executable is now extracted from the just-verified archive into a sibling staging file and published atomically after extraction and chmod succeed. Archive SHA-256 checks remain mandatory.
