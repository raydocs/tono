## 2026-09-30 · macOS live policy revocation replaces old DIRECT authority
- 归属：SHIP_PLAN §2 item 10; macOS connected catalog/traffic-policy mutation.
- 来源：origin/main `6a9994ca` → `hunt/sol-r4sw-mac-policy-rebuild`; PR #1115; source only.
- 缺陷修复：the in-place owner now rebuilds the latest accepted policy instead of carrying old suffix/native DIRECT grants. Empty policy clears the prior plan; suffix-only policies reach the owner. Connect-time deferral reads the latest policy too.
- 新增/优化：无；keep ordinary connected session, AI admission guards, current interface provenance and strict policy. Hold old PF grants until runtime replacement, then converge exact new grants.
- 工程与测试：one actual accepted-cache empty revocation/commit regression and one real preparation/compiler suffix/native replacement regression. A boundary replaces only privileged mutation after real desired-plan preparation.
- 验证：`git diff --check` passed; independent source/task/test review passed. Native Swift/XCTest cannot run on Linux; hosted macOS CI required. Baseline skips empty policy and retains old authorization; no native failing execution claimed here.
- 候选/发布：仅源码，无新候选；no deploy/publish; no helper contract or UI change.
- 剩余限制：needs-hardware for ordinary traffic through transition and exact PF grant convergence; busy-owner policy overlap remains issue #1114; catalog-removal owner overlap issue #1113.
