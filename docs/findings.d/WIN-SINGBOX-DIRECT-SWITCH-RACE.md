| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SINGBOX-DIRECT-SWITCH-RACE | The sing-box DIRECT process replacement ran without the policy/mutation admission the mihomo bracket takes, so a hot switch or policy update could interleave and Core restarted on the node the session had left | fixed(e38c9cfb) | hunt/claude-r4late-singbox-direct-admission | 中·推导（P2，源码与回归） | Real Windows hot switch during sing-box DIRECT not exercised; CI runs the regression |

`replace_sing_box_for_direct` (#1175) only checked `ensure_fresh` before `ReplaceSingBoxRuntime`. A hot switch keeps the
same connect generation, holds the policy and privileged writers, and narrows the WFP proxy endpoints to the new node. A
replacement compiled for the old node could then restart Core with that node as default after the switch settled; the
tunnel dies until a health release (normal internet plus AI hold, not a cut) or reconnect. The replacement now takes
`begin_policy_activation` then `begin_connect_mutation` and rechecks `direct_context_is_current`, as the mihomo bracket
does, and keeps that policy reader through the commit.
