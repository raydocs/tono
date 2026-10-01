## 2026-09-30 · Windows Activity keeps valid executable names as strings
- 归属：SHIP_PLAN §2 item 10; Windows Activity reliability.
- 来源：origin/main `b341164b` → branch `hunt/sol-winapp-activity-process-key`; source PR, not merged at authoring.
- 缺陷修复：WIN-ACTIVITY-PROCESS-PROTOTYPE (P2): a constructor.exe flow returned an inherited object function as its display family and threw during page rendering; only declared own family keys now override an executable basename.
- 新增/优化：无; known family labels, filtering, counts, layout and all network/protection policy are preserved.
- 工程与测试：one actual ActivityPage regression verifies constructor.exe renders; no test skipping or configuration changes.
- 验证：Linux existing Node 22.14.0 and pinned frozen frontend dependencies: baseline selected regression failed with row.process.toLowerCase TypeError; fixed Activity file passed all 20 tests. TypeScript typecheck, touched-file ESLint and `git diff --check` passed. Formatter reported only the pre-existing unchanged serversMock layout at activity.test.tsx:138; no style churn added.
- 候选/发布：仅源码，无新候选，无部署/发布。
- 剩余限制：no native Windows game/socket capture; executable and online multiplayer supported by primary developer sources, socket attribution is inferred.
