| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SOL-CP-HY2-RETIRE-DRAIN | Node retirement misses recent clients selecting its hy2 block, withdraws exit admission before drain, and prematurely resolves retire_pending | fixed(6dc5b90d) | hunt/sol-cp-hy2-retire-drain | 中·已确认 (P1) | Requires real-device validation; already admitted QUIC streams may continue, but new admission is withdrawn. |

Telemetry stores the selected transport name verbatim. `retireDependencies` matched only the base name; retirement and its cron sweep therefore revoked the exit token for an occupied HY2 node. Exit-agent handles `EXIT_NODE_DISABLED` by withdrawing its roster. The verdict occupancy map likewise keyed the hy2 alias separately from the base machine and cleared the pending incident. Both paths now count the transport against its existing node identity, preserving the normal drain interval.
