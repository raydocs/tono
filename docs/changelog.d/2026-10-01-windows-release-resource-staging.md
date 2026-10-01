## 2026-10-01 · Stage Windows release resources before their gate
- 归属：SHIP_PLAN §2 item 10；Windows release build tooling.
- 来源：main `1458a9de` → `hunt/sol-r4rel-windows-staging`; not yet merged.
- 缺陷修复：fresh checkout aborted at the full resource preflight before it built Service. Both scripts now stage Service/core resources and then run the unchanged preflight before App packaging. The cross-build creates its resource directory; both copy the committed core identity.
- 新增/优化：无；all complete config and installer payload checks remain required.
- 工程与测试：one dependency-order regression covers both build entry points, resource identity and cross-build directory creation.
- 验证：Linux Node 20.19.2; baseline regression 0 passed / 1 failed; focused packaging/component/desktop-update tests 46 passed / 0 failed. Native Windows PowerShell and macOS zsh packaging unavailable here.
- 候选/发布：仅源码，无新候选；no release, publish or deployment performed.
- 剩余限制：portable ordering regression does not establish native packaging acceptance; CI remains required.
