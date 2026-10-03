| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SINGBOX-DIRECT-LOCKED-PERMIT-MONITOR | During this session's own sing-box DIRECT replacement the Service can report Locked with the tunnel permit retracted for up to ~3 s; the monitor excused only owned Blocked, so two 2 s ticks could trip the kill-switch leg and reconnect (the #1245 leftover) | fixed(bc2807fe) | hunt/claude-r2-win-monitor | 低·推导（P2，源码与回归） | Window length depends on netsh/NRPT cleanup time on the device (needs-hardware); outcome was a reconnect, never a cut |

Source: `retract_direct_before_core_replacement` → `transition_direct_to_blocked_unlocked` → `install_unlocked_for` stores
`TUNNEL_PERMIT_RENDERED=false`, then awaits `selective_layer::remove()` (two `netsh` deletes plus NRPT removal, 3 s step
budget) before `ARMED` is published as Blocked. `status()` reads both without the WFP lock, so it reports
`mode: Locked, tunnel_permit_rendered: false` for that whole wait. The monitor now excuses that reading only while the
owned-reload marker (60 s deadline) is set, exactly like owned Blocked.
