## 2026-10-13 · Rust 工具链 1.98.1 → 1.99.0
- 归属：ops 工具链漂移 Issue #257（所有者 2026-10-13 决定现在升级，不等 0.0.75）；Windows 构建与 CI。
- 来源：基线 `origin/main` 358fd9da1 → 分支 `claude/toolchain-rust`；PR 见 GitHub。
- 缺陷修复：无。
- 新增/优化：Rust 固定版本升到 1.99.0（上游 stable 2026-09-28）：`apps/windows/app/rust-toolchain.toml`、`apps/windows/crates/tono-plugin-core/rust-toolchain.toml`、`windows-release.yml` 与 `windows-candidate.yml` 的 `dtolnay/rust-toolchain` 输入、`tooling/scripts/test-desktop-stability.py` 的 `cargo +版本`。`rust-version = "1.98"`（最低支持版本）不动。
- 工程与测试：windows-ci 的 clippy 步骤读 `app/rust-toolchain.toml`，`-D warnings` 用 1.99.0 跑；新增 lint 的修复若有，见本 PR 的后续提交。
- 验证：见 PR 的 Verification。本机不跑原生 cargo。
- 候选/发布：无新包，仅源码。
- 剩余限制：`windows-release.yml` 不在 ci-gate 里运行，首个使用 1.99.0 的候选构建才会证明发布流程。
