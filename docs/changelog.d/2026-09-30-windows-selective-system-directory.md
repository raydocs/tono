## 2026-09-30 · Windows selective recovery on non-C installations

- 归属：SHIP_PLAN §2 item 10；Windows selective fail-open / AI blocking.
- 来源：origin/main `89a0e0e7` → branch `hunt/sol-r4fo-selective-system-dir` (this PR); source only, not yet merged at authoring.
- 缺陷修复：Recovery used a fixed C-drive netsh path and omitted Anthropic prefix rules on non-C Windows installations. The native runner now uses the existing GetSystemDirectoryW provider after validating the same immutable prefix-only templates. Finding: R4FO-WIN-SELECTIVE-SYSTEM-DIR.
- 新增/优化：无；domain/IP sets, strict mode, explicit Restore and cleanup sequencing are unchanged.
- 工程与测试：One narrow regression checks the command executable and arguments for a D-drive system directory.
- 验证：Linux `CARGO_BUILD_JOBS=2 cargo test --manifest-path apps/windows/service/Cargo.toml -p tono-service-protocol --locked --features standalone,client,test --lib firewall_command_uses_the_os_system_directory_on_non_c_windows` failed on the original binding (0 passed, 1 failed). After the fix, the same package/filter `--lib core::selective_` passed 7 tests, including prefix/catch-all guards and late-worker ordering. Receipts: `out/R4-FailOpen/selective-system-dir-{baseline,fixed}.log`; native Windows execution not run here. `git diff --check` passed.
- 候选/发布：仅源码，无新候选；未部署或发布。
- 剩余限制：GetSystemDirectoryW and actual firewall application/removal on a non-C Windows installation require hosted Windows CI and device testing (`needs-hardware`). Existing best-effort command failure handling is unchanged.

2026-09-30 continuation: rebased onto `957a4c5d` after #1087 merged. The OS-directory binding now lives in its shared `run_command`, covering set/add/delete while retaining set-success and add-fallback behavior. The same narrow selective suite passed 8 tests on the combined source; `git diff --check origin/main...HEAD` passed. Receipt: `out/R4-FailOpen/selective-system-dir-rebase-fixed.log`. Native execution remains unrun locally.
