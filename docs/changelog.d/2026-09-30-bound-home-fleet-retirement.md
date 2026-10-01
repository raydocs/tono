## 2026-09-30 · Protect bound residential exits from fleet retirement

- 归属：SHIP_PLAN §2 item 10 / ops plan node retirement; control-plane managed catalog.
- 来源：origin/main `7f382af7` → `hunt/sol-r4sw-bound-home-retirement`; PR #1083; source only.
- 缺陷修复：a fleet retirement may no longer remove/revoke a catalog home that customers still bind through homeProxy, even when their selected/default cloud exit is another node. Reuse the existing HOME_EXIT_IN_USE refusal for base and stored HY2 alias home identities.
- 新增/优化：无；existing unbound-node drain/relist semantics retained.
- 工程与测试：one Worker/D1 regression drives a real catalog_retire job with a bound home and another selected cloud exit; catalog, token and binding remain intact.
- 验证：`npm ci` passed; `npm run typecheck` passed (indexed-access ratchets 521/521 and 97/99); regression failed before the guard and passed afterward; complete `test/ops-jobs.test.ts` passed 15/15; `git diff --check` passed. Linux + cached Node 24.21.0; disposable local Workers/D1 only.
- 候选/发布：仅源码，无新候选；no deploy/publish or production database operations.
- 剩余限制：concurrent bind-vs-retire retains the existing pre-write guard model; separate relist-token race #1072 and relisted HY2 SPKI loss #1073 remain open.
