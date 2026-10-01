| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R3REGW-AI-TALLY-SEEN-GROWTH | AI traffic receipt IDs accumulate for the entire controller generation after completed flows leave the bounded feed. | in-PR | #1085; hunt/sol-r4i1085-ai-tally | 低·实测（P3） | No OOM or machine hang demonstrated. A flow absent from the truncated feed long enough to be evicted can recount if it later reappears. |

Baseline `6ba79f61`, `apps/windows/app/src/tono-ui/AiTrafficCard.tsx:28` and `ai-traffic.ts:56`: the module map resets on controller generation but the accumulator never retires historical IDs. The feed's 2,000 active and 500 closed limits do not bound this separate map. A regression retaining 2,000 active IDs and rotating 6,000 completed IDs produced 8,000 receipts.

Cap receipts at 2,500. Refresh every eligible ID's insertion order, including unchanged byte counts, then prune after the whole frame. Current feed IDs remain retained; empty initial snapshots preserve bounded recent receipts across same-generation remounts. The existing generation reset remains unchanged.

`bounds completed receipts while preserving current-frame and remount dedup` failed before the fix with 8,000 receipts, then passed with 2,500 and an exact 780,000-byte tally. Final-frame replay, an empty snapshot and another replay add no bytes. This is local display accounting, not provider quota or billing.
