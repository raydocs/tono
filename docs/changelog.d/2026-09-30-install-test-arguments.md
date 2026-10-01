## 2026-09-30 · Refuse missing helper lifecycle test arguments
- 归属：SHIP_PLAN verification tooling; T4-INSTALL-MISSING-ARG (P3 operator only).
- 来源：origin/main `33d46892`; branch `hunt/sol-misc-install-arguments`; [#892](https://github.com/raydocs/tono/pull/892), not yet merged.
- 缺陷修复：a trailing value-taking option caused an endless failed-shift loop; refuse it with usage and exit 2 before privileged checks.
- 新增/优化：无；helper installation and recovery behavior untouched.
- 工程与测试：one Python subprocess regression against the actual zsh runner; wire it into macOS policy CI and the aggregate.
- 验证：Linux Python 3.13.5 + extracted Debian zsh 5.9: failed before with 2-second timeout; passed after (1 test, all three malformed options refused). Both edited shell syntax checks and git diff --check pass. Existing recovery suite attempted but all seven native tests skipped by their existing macOS guard; no recovery result claimed.
- 候选/发布：仅源码，无新候选；no deployment/publication.
- 剩余限制：real macOS zsh execution awaits CI; no privileged install was attempted. Separate aggregate input/hidden-skip limitations remain recorded in the PR body.
