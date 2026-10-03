| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SOL-C5-RELEASE-RANGE-BUFFER | Legacy installer ranged GET buffers and copies the selected R2 body before responding, risking Worker memory exhaustion during resumed downloads | fixed(33d46892) | hunt/sol-cp-stream-release-ranges | 低·已确认 (P2) | Regression proves eager consumption; no production memory exhaustion reproduced. |

`services/control-plane/src/releases/host.ts:118` buffered `/download/*` ranges, while detached v1 packages streamed the same R2 range contract. R2 restricts the returned body already. The fix streams that body on both paths with unchanged range headers and exact bytes.
