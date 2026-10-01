## 2026-09-30 · Rebuild a Windows connection after a catalog rotation during startup

- 归属：SHIP_PLAN §2 item 10; Windows connect/catalog residential routing.
- 来源：origin/main `7f382af7` → `hunt/sol-r4sw-connect-catalog-routing`; PR #1066; source only.
- 缺陷修复：a residential catalog rotation during Connecting no longer leaves the successful runtime on the old endpoint/credentials indefinitely. The final atomic commit compares the exact startup residential graph and queues the existing catalog recovery for that generation.
- 新增/优化：无；reuse the existing residential identity comparison and protected rebuild. Stale DIRECT/pin-refresh tasks are not started for that superseded snapshot.
- 工程与测试：one native regression, `connected_commit_detects_residential_credentials_rotated_during_startup`, exercises the real commit mutex and snapshot comparison. Existing stale-controller regression remains intact.
- 验证：`git diff --check` passed; Rust syntax parsed with rustfmt. Windows/Tauri compilation and native regression unavailable on this Linux VM; hosted Windows CI required. No native networking exercised.
- 候选/发布：仅源码，无新候选；no deploy/publish.
- 剩余限制：needs-hardware for residential endpoint/credential rotation during connect and concurrent selection/disconnect; existing cold-switch recovery semantics are retained.
