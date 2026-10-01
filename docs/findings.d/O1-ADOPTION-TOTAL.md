| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| O1-ADOPTION-TOTAL | Client headline adds overlapping cell users and counts the same person repeatedly | open | [#915](https://github.com/raydocs/tono/pull/915) | 低·已确认 | P2; Distinct-customer semantics/union aggregate or explicit membership wording needs a decision |

A customer with current macOS and Windows devices contributes one user to each current cell. `pages/Clients.tsx:159` adds both cell user counts; `copy/clients.ts:4` labels the resulting two as people.

The Worker deliberately deduplicates only within each cell (`services/control-plane/src/ops/adoption.ts:386`, overlap documented at `:348`). It provides aggregate counts without identities, so the console cannot reconstruct a distinct-user union. Per-cell device or user counting is not itself a bug; the combined people headline is.

Decision item: define the combined headline as distinct customers and supply a server union aggregate, or explicitly describe platform/bucket memberships. Changing totals or wording without that choice would invent semantics. No fix or decision-file edit in this pass.
