| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| O1-COMMAND-IDENTITY-COLLISION | Private customer and invite labels collide as command identities and open the wrong person | in-PR | [#969](https://github.com/raydocs/tono/pull/969) | 低·已确认 | P2; ui-review, no auto-merge |

`services/ops-console/src/app/CommandPalette.tsx:95,119` uses displayed email plus handle as cmdk value. Two unrelated people with no WeChat handle and the same masked address both become selected; Enter invokes the first item even after hovering the second. Verified on real cmdk with two customers and with a customer/invite pair. Give each row a unique identity, keep displayed address/known handle as searchable keywords, and filter out identifiers (invite keys contain the unmasked email). Remount when search fields change because cmdk1.1.1 caches keywords by value.
