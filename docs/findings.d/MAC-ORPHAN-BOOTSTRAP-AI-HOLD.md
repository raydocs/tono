| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-ORPHAN-BOOTSTRAP-AI-HOLD | The merged orphaned-bootstrap crash recovery stops Core and disarms PF without restoring the secondary AI hold | fixed(3853f5ec) | hunt/sol-r3helper-failed-barrier-ai-hold | 中·已确认（P1，源码路径） | Follow-up to merged #773; preserves its general-network recovery. Native execution awaits macOS CI/hardware; the narrow layer remains best-effort. |

SHIP_PLAN §2 item 10. On baseline `87a0754c`, an ordinary App crash during Connect is handled by `SocketServer.releaseOrphanedBootstrap`: Core stop, `disarm()` (which removes the AI layer), DNS recovery, owner clear. Saved intent is then absent, so neither startup nor the no-intent watchdog branch reapplies the hold. The same automatic release now invokes the existing state-guarded selective installer immediately after successful disarm; explicit user disarm is unchanged.
