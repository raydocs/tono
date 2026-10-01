| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| O1-ADOPTION-DRILLDOWN | Platform adoption drilldown uses a different device cohort from its matrix cell | open | [#915](https://github.com/raydocs/tono/pull/915) | 低·已确认 | P2; A matching server cohort/window contract is required; no console-only fix |

A customer reports macOS 0.0.73 and Windows 0.0.74 within the matrix's rolling 24-hour window, with Windows 0.0.74 current. The Windows/current matrix cell includes that customer, but its linked list excludes them because it buckets the all-platform minimum 0.0.73.

Path: `pages/clients/AdoptionMatrix.tsx:98` → `pages/Customers.tsx:125` → `lib/customers.ts:223`. `selectByBucket` uses global `minAppVersion`; the Worker derives that across 30-day devices (`services/control-plane/src/ops/customers-device.ts:43`, exported at `ops/handlers/customers.ts:177`). Matrix membership instead uses latest per-device versions in rolling 24 hours (`ops/adoption.ts:76,309,379`). Platform selection cannot restore a discarded per-platform version/window.

Needed: server cohort filtering, or per-platform bucket memberships derived with the matrix's identical window and version rules. This extends the API contract beyond the small console fixes authorized for this pass. No proposed schema or product decision is committed.
