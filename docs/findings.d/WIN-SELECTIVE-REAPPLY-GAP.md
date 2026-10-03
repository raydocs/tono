| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SELECTIVE-REAPPLY-GAP | Reapplying the Windows selective AI hold deletes its existing prefix and DNS rules before reinstalling them | fixed(3b7cbd1d) | Branch `hunt/sol-r4ks-selective-reapply` | 低·已确认（P2，Linux regression） | Native Windows command execution unrun; native failures/hangs and DNS cache coverage remain existing limits. |

Baseline `89a0e0e7`. Repeated automatic release and startup of retained corrupt/unreadable intent both request the same hold. The revisioned worker previously deleted the active hold even without a Restore request. #1044 removed one redundant DIRECT-expiry caller, but these callers remained.

The worker now reconciles an apply in place. Each fixed outbound firewall rule is updated before falling back to an add for that rule; NRPT overwrites its existing fixed keys. Explicit removal remains serialized. `repeated_application_never_removes_the_existing_ai_hold` failed with one active-hold removal before the fix, then passed with zero. Native command syntax follows Microsoft's netsh reference; actual packet protection needs hardware acceptance.
