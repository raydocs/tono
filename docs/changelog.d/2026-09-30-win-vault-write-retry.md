## 2026-09-30 · Retry failed Windows session vault mutations
- 归属：SHIP_PLAN §2 item 10; Windows session reliability.
- 来源：origin/main `50bbbbf0` → branch `hunt/sol-trust-vault-write-retry`; [#843](https://github.com/raydocs/tono/pull/843); source fix only.
- 缺陷修复：a transient credential write failure discarded the desired token and made every durability flush return the same cached error; flush now retries the latest failed write/delete once in the existing ordered writer.
- 新增/优化：none; account markers still commit only after durable acknowledgement, and newer mutations supersede stale failed values.
- 工程与测试：one narrow real-writer regression, alongside the existing delayed mutation ordering regression.
- 验证：Linux Rust 1.98.1 extracted portable harness of the production writer and checked-in tests: new regression failed before the fix with the injected Store error; after the fix 2 passed. `git diff --check` passed. Full Tauri/Windows-native tests not runnable here; CI must execute them.
- 候选/发布：source only, no new candidate, deployment or publication.
- 剩余限制：actual Credential Manager faults were not injected on Windows hardware; a permanently failed or hung vault still cannot acknowledge durability.

2026-09-30 continuation: first hosted Windows run (head `cf76398c`, run 36795661106) compiled and passed the new regression, but its App suite was 571 passed / 1 failed: the existing account-close fixture refused only its first deletion, so the new flush retry correctly succeeded. The fixture now refuses all deletions until explicitly released; every durable-error/admission/token assertion remains. Full-suite rerun is pending CI.
