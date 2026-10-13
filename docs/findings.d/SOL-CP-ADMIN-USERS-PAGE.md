| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SOL-CP-ADMIN-USERS-PAGE | Customer list stopped at 2000 rows and dropped the next-page cursor (legacy admin client, then the ops-console) | in-PR | [#1058](https://github.com/raydocs/tono/issues/1058) | 低·推导 (P3) | Legacy client removed in 50a94765a; the ops-console list now follows `nextCursor` to the end (guard 50,000 rows, `MAX_CUSTOMERS` in `lib/api.ts`), test `src/lib/api-paging.test.ts`. Other lists keep the 2,000-row guard. Past 50,000 customers the shell would again drop the cursor silently |
