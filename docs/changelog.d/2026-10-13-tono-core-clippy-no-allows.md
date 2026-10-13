## 2026-10-13 · tono-core 的 clippy 门禁不再放行任何 lint；新增只报告的覆盖率 job
- 归属：Windows 计划（CI）；`apps/windows/crates/tono-core`、`.github/workflows/windows-ci.yml`。
- 来源：Issue #862；分支 `claude/tono-core-clippy`。
- 缺陷修复：Linux `core` job 的 "Lint tono-core" 原先放行 `clippy::collapsible_if`（8 处）和 `clippy::too_many_arguments`（1 处）。8 处嵌套 `if` 改为 let-chain（`auth.rs` 2 处、`catalog.rs` 2 处、`config.rs`、`heal.rs`、`unarmed_probe.rs`、`update_journal/store.rs`），行为不变；`config.rs` 的 `runtime_value` 把 `home` 与 `home_socks5` 合成私有结构体 `HomeRoute`。两个 `-A` 已从门禁中删除，现在是 `-D warnings`。
- 新增/优化：新的 Linux job `core-coverage`（`cargo-llvm-cov` 0.9.1），只在运行摘要里报告 `tono-core` 行覆盖率，不设下限；无 `needs`，`continue-on-error: true`，不在 Windows CI 关键路径上。
- 工程与测试：`cargo +1.98.1 clippy --locked -p tono-core --all-targets -- -D warnings` 本机通过；`cargo +1.98.1 test --locked -p tono-core` 349 + 其余全部通过。
- 验证：见 PR 的 Verification 一节。
- 候选/发布：仅源码与 CI，无新候选。
- 剩余限制：覆盖率没有下限，需要第一次 CI 的数字后再另行决定；`core-coverage` 的耗时以首次 CI 为准。
