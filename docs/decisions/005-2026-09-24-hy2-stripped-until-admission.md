## 2026-09-24 · hy2 blocks in the customer catalog before client admission is proven

- Status: provisional
- Chosen: keep ` · hy2` stripped from customer catalogs and do not PUT hy2 blocks
  until client admission is on `main` and the owner has supplied the
  `HY2_CATALOG_EMAILS` value (never committed); bump the catalog revision after
  changing it. Rejected: publishing hy2 blocks to internal accounts first.
- Why stricter: no customer sees a transport the shipped clients cannot admit.
- Applied in: [SHIP_PLAN.md](../SHIP_PLAN.md) §3 item 5.
