## 2026-09-30 · Windows unarmed recovery preserves newer selection
- 归属：SHIP_PLAN §2 item 10; Windows node switching and automatic recovery.
- 来源：origin/main `b786b44f` → `hunt/sol-r4sw-unarmed-selection`; PR #1098; source only.
- 缺陷修复：an old successful TCP proof no longer overwrites a newer idle user selection. Recovery starts a fresh round for the new selection using the monotonic elapsed clock introduced by #1106.
- 新增/优化：无；same-generation background recovery, selective AI hold and explicit strict barrier retained.
- 工程与测试：one narrow real TonoState admission regression changes selection during an outstanding proof without changing generation; tests the same helper called under the production state lock.
- 验证：`git diff --check` and Rust parser via `rustfmt --emit stdout` passed. Native Windows App test cannot run on this Linux VM; CI must execute it. Baseline assignment would return true and replace B; no native failing run is claimed.
- 候选/发布：仅源码，无新候选；no deploy/publish.
- 剩余限制：needs-hardware; stale old-session health release tracked in #1095; reachable-TCP failed-connect backoff fixed by #1106. Rebase onto `520294ad` preserved both the merged native-observer regression and this selection regression.
