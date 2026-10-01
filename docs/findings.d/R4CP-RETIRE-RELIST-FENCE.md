| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4CP-RETIRE-RELIST-FENCE | Immediate retirement token cleanup can disable an exit after a concurrent relist has committed | in-PR | hunt/sol-r4cp-retire-relist-fence | 中·已确认 (P2) | Requires overlapping administrator retire/relist operations; real-node acceptance not run, no deployment. |

The existing `revokeExitToken` catalog revision fence is used by the drain sweep, but omitted by `retireFleetNode` and the catalog-retire worker. Both now pass the retirement/observed revision. Two narrow D1 regressions inject an actual successful relist immediately before each caller's revocation UPDATE. Before the fix, both leave the node listed but its token disabled; after the fix its original active token remains. Unrelated catalog changes defer revocation to the existing drain sweep.
