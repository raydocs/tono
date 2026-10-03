| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DNS-DOH-NEW-TEMPLATE | Newly appearing adapters' enabled DoH flags are zeroed without being appended to an existing capture, so Disconnect cannot restore them | fixed(76ed9665) | Branch `hunt/sol-r3dns-doh-new-template` (this PR) | 低·已确认（P2，源码路径；Windows regression added） | Windows native regression and installed adapter-change behavior await CI/hardware; existing capture-loss handling unchanged |

During an existing session, `suppress_interface_doh` kept a readable capture unchanged but suppressed every currently enabled template, including a new adapter or template. Restoration later enumerated only the saved capture. The new flags were therefore permanently left suppressed after Disconnect.

Merge newly seen `(GUID, family, server)` identities into the saved capture before clearing any flags; existing originals remain authoritative and matching is case-insensitive. A failed append refuses suppression. The Windows fixture regression inspects the actual capture at the first policy mutation, then verifies both adapters' original flags are restored.
