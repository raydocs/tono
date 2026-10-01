| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4TS-NODE-META-PROTOTYPE | Valid unusual catalog names resolve inherited node metadata and crash rendering rather than use the unknown-node fallback | in-PR | hunt/sol-r4ts-metadata-owned-keys | 低·已确认（P2，实际模块回归） | Requires an unusual administrator-issued catalog name; no machine/network crash or protection change. Native acceptance not run. |

Baseline `6758431f`: `nodeCityParts('__proto__')` calls `nodeDisplayName` at `node-meta.ts:80`, whose ordinary-record lookup returns an inherited object; `nodeCityParts:188` throws at `.split`. Catalog admission (`tono-core/src/node.rs:258,38–48`) accepts the name. After guarding that first map, the city-code/region/title maps also need own-key checks to preserve ordinary unknown-node fallbacks. One narrow regression traverses the actual public metadata functions for that valid unknown name; it failed with `.split is not a function` before and passes after.
