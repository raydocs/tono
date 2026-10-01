## 2026-10-01 · Windows candidate: Tauri updater JS plugin matches its crate again
- 归属：SHIP_PLAN §2 item 10；Windows candidate build (#1215).
- 来源：main `6e65ad81`+ → `fix/win-updater-plugin-version-match`.
- 缺陷修复：the 2026-09-27 windows-frontend group bump moved `@tauri-apps/plugin-updater` to 2.12.0 while the `tauri-plugin-updater` crate stayed 2.11.0, so `tauri build` refused and no Windows candidate could be built. The JS package is pinned back to 2.11.0; the App only imports its `DownloadEvent` type. The updater crate, its signature checks and the release trust path are unchanged.
- 新增/优化：无。
- 工程与测试：one node test in windows-ci checks every locked `@tauri-apps/plugin-*` against its locked `tauri-plugin-*` crate minor, so a split bump fails CI instead of the candidate.
- 验证：local node test fails on main (`2.12.0 vs 2.11.0`) and passes on the branch; `pnpm install --lockfile-only` resolved. Candidate build itself runs in hosted CI after merge.
- 候选/发布：仅源码，无新候选。
- 剩余限制：none known.
