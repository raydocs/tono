## 2026-09-30 · Avoid false missing-suite reports from a broken input pipe
- 归属：SHIP_PLAN §2 item 10 supporting test tooling; T4 audit.
- 来源：origin/main `7d525e6c`; branch `hunt/sol-misc-suite-reachability`; [#823](https://github.com/raydocs/tono/pull/823), not yet merged.
- 缺陷修复：无客户运行时缺陷；P3 engineering finding T4-REACHABILITY-SIGPIPE is recorded separately for this hunt.
- 新增/优化：无；registration requirements remain enforced.
- 工程与测试：replace grep's early-exit mode with a full-input search. One behavioral Node test reproduces the false rejection and confirms an unwired suite still fails. Register it with the macOS aggregate; Services CI already runs all `.test.mjs` suites.
- 验证：Linux `node --test tooling/scripts/tests/suite-reachability.test.mjs` failed before the fix and passed after (1/1); `bash -n` and `git diff --check` passed. Actual-tree guard no longer emits broken pipes, but still exits 1 for eleven pre-existing registration gaps.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：wildcard test invocations are not recognized as individual registrations, and some suites have no explicit callers. No changes to those checks or workflows in this PR. macOS/zsh execution unavailable here.
