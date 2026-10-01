## 2026-10-01 · Retain overdue customers in dashboard reporting
- Ownership: SHIP_PLAN §2 item 10; ops console customer data accuracy.
- Source: baseline `c8844503`; branch `hunt/sol-r4fcp-overdue-customer-counts`; fixes #1068.
- Defect fix: list refresh changes overdue accounts to lifecycle=expired, making them disappear from the overdue KPI and lapsed chart. Both calculations now include their past-expiry rows.
- Added/optimized: none; active load/usage/online, upcoming expiries and suspended exclusions retain their policy.
- Engineering/tests: one narrow overdue KPI regression and one lapsed-bucket regression, both failed before the fix. Existing active/stale-row cases retained.
- Verification: Linux Node24, npm ci reused unchanged console lockfile; targeted Vitest4 tests, typecheck/indexed-access171/219, targeted ESLint and diff check passed. Independent read-only review passed.
- Candidate/publication: source only, no new candidate, deploy or publication. ui-review; no auto-merge.
- Remaining limits: counts cover the list currently loaded by the dashboard; no full-fleet aggregation change. User visual/value review required.
