| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| HY2-PROVISION-SPKI | HY2 provisioner drops the node's SPKI pin from its private catalog source, so macOS refuses the newly provisioned transport | in-PR | hunt/sol-r3ops-hy2-catalog-spki | 中·已确认（P1，源码） | Ruby CLI regression requires hosted CI; real-node/macOS HY2 acceptance not run. No provisioning or publication performed. |

The remote helper already returns the same-certificate pin. The provisioner now validates canonical 32-byte base64 and retains it beside the mandatory DER fingerprint. This closes the integration gap acknowledged in the 2026-09-26 SPKI changelog; client certificate admission stays strict.
