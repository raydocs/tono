| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FCP-CUSTOMER-SUBJECT | Customer navigation can combine the previous account's billing with the next account's mutation target | fixed | [#1207](https://github.com/raydocs/tono/issues/1207); [#1208](https://github.com/raydocs/tono/pull/1208) | 高·已确认（P1） | UI review pending; no manual browser acceptance |

App reused CustomerDetailPage across customer IDs. During the new resource's loading effect, useSticky relabeled the old ready value under the new ID; after an ordinary detail-read failure the previous email and billing remained indefinitely. Billing received the new userId and the old billing; actual reset confirmation targeted the new account. One actual-App jsdom regression fails on baseline `36a31ae7` with `patchUser('customer-b', {resetUsage:true})`. Keying the page by customer ID remounts all subject-specific resource, sticky, form and confirmation state. Same-customer refresh preserves the component.
