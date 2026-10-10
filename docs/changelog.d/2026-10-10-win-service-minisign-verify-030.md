## 2026-10-10 · Windows 服务 minisign-verify 0.2.5 → 0.3.0（dependabot）
- 归属：ops 计划 §2 依赖维护；`apps/windows/service`（更新包签名校验）。
- 来源：dependabot PR #1424（`c78a45612`，只改 service 的 Cargo.toml/Cargo.lock）→ 续修 `9e8475f34`：app 工作区的 `Cargo.lock` 也锁上 0.3.0（service 是 app 的路径依赖，`--locked` 下原 PR 在 `windows / app-rust` 失败「cannot update the lock file」）；tauri-plugin-updater 继续用自己的 0.2.5，两个版本并存。
- 缺陷修复：无。
- 新增/优化：依赖升级。`PublicKey::decode` / `Signature::decode` / `verify(bytes, &signature, allow_legacy)` 在 0.3.0 签名未变，`core/update.rs` 不改；库本身无依赖。
- 工程与测试：ci-gate 在 `9e8475f34`（见 PR）；Grok-only 评审（发布信任路径，所有者 2026-10-08：Codex 不可用）。
- 候选/发布：无新包；下一个 Windows 构建自然带上。
- 剩余限制：无。
