## 2026-09-30 · 登出撤销刷新已经换出的会话
- 归属：工程（质量门）；控制面会话与 Windows 选路谓词。
- 来源：`origin/main` → 分支 `qg/session-races`。
- 缺陷修复：刷新先提交时，登出只按访问令牌里的旧会话号打 `revoked_at`，继任会话仍是活的。登出在同一批语句里按 `successor_id` 再撤销那一行。刷新的 `revoked_at IS NULL` 比较交换没有放宽。
- 新增/优化：无。
- 工程与测试：`session-refresh-logout.test.ts` 先刷新再以旧会话号登出，要求该用户没有 `revoked_at IS NULL` 的会话，新访问令牌访问 `/api/v1/me` 为 401。Windows `select_action` 在 `is_disconnecting` 时保持 `UpdateOnly`，不切换、不重连。
- 验证：`npx vitest run test/session-refresh-logout.test.ts`。Windows 断言随 `windows-ci` 的 app-rust 作业，本机不能编 Tauri。
- 候选/发布：仅源码，无新候选。
- 剩余限制：没有把登出和刷新做成会卡在两条语句之间的测试钩子。覆盖的是刷新已经赢了之后的登出语句。
