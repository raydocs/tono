| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| O1-PUBLISH-METADATA | Successful publication keeps the previous document timestamp and signature | fixed(e7d14f39) | [#965](https://github.com/raydocs/tono/pull/965) | 低·已确认 | P2; ui-review, no auto-merge |

`services/ops-console/src/pages/settings/use-document.ts:135`. The publish callback returns only revision; online spreads the previous snapshot. Catalog and policy adapters already parse updatedAt and hashes/signatures. A previously signed policy published unsigned still displays signed until a reload. Apply the returned metadata with the new revision; do not replace text typed during the request.
