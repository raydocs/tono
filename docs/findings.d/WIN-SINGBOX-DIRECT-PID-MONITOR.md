| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SINGBOX-DIRECT-PID-MONITOR | The sing-box DIRECT process replacement changed the Core pid without the owned-reload marker, so the network monitor read it as a Core crash and could rebuild, and the rebuild ran DIRECT again (RegLate H5) | in-PR | #1228 | 中·推导（P2，源码与回归） | How often a tick lands inside the replacement needs hardware (needs-hardware) |

The replacement now sets the owned-reload marker before `ReplaceSingBoxRuntime`, and once the commit proof passes it
adopts the proved pid and restart count as the monitor baseline while the marker is still set. The monitor defers a Core
identity change, and keeps the old baseline, while the session owns the reload or the marker moved during the tick; an
unexplained change still fires on the first tick after.
