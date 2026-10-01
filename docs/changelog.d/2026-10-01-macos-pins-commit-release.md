## 2026-10-01 · macOS committed pins failure restores ordinary internet
- 归属：SHIP_PLAN §2 item 10 / G1，macOS runtime recovery.
- 来源：baseline `efc511da`; branch `hunt/sol-r4fmc-pins-commit-release`, pending PR/CI review.
- 缺陷修复：failed replacement-TUN/PF convergence after pins commit now retires the reload owner, stops Core, restores DNS and selectively releases ordinary internet with the AI hold. Retry uses the existing unarmed proof/backoff. Retired update work cannot launch a second release.
- 新增/优化：无；precommit keep-session and shared strict disposition unchanged. Uses the existing common failure presentation in place of the inaccurate all-block notice; requires UI review.
- 工程与测试：one actual-transaction regression for committed tunnel failure, one for native-update retirement; test I/O is contained and modified files/defaults restored.
- 验证：Linux `git diff --check` and records parsers; Swift/XCTest execution unavailable locally, macOS CI required. Primary regression authored before production patch; no native failing execution claimed.
- 候选/发布：仅源码，无新候选、部署或客户发布。
- 剩余限制：PF/DNS hardware acceptance and UI review; helper repair/DNS restore/selective release errors retain existing truthful recovery handling. Known #1057 decisions remain separate.
