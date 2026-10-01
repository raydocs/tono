| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| O1-ANCHOR-CLAMPED | Saving a node profile in a short month replaces configured quota anchor31 with28 | open | [#915](https://github.com/raydocs/tono/pull/915) | 低·已确认 | P2; Configured anchor is absent from DTO; expose it or preserve untouched quota patches |

A calendar quota configured for day31 correctly opens its February cycle on day28 (`services/control-plane/src/ops/quota.ts:90`). `ops/handlers/nodes-data.ts:192` exposes cycleStart but not configured anchor day. `pages/node/ProfileDrawer.tsx:80` reconstructs 28 and sends it on any save (`:113`), including a notes-only edit. The Worker replaces configured anchor (`ops/handlers/nodes-profile.ts:164`) and persists it (`:197`). Future months now reset on day28.

The documented complete-form submission and valid server clamp do not preserve the missing configuration. #805's UTC-date fix addresses a separate timezone error and still cannot recover31 from February28.

Needed: expose configured `cycleAnchorDay` in `NodeQuotaDto` and seed the form from it. Preserving unchanged quota patches can prevent incidental writes, but cannot display an anchor the API omits. This requires contract/payload work beyond this tiny console pass; no decision-file edit.
