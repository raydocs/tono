## 2026-09-30 · Preserve the AI hold after macOS browser DNS health failure
- 归属：SHIP_PLAN §2 item 10; combined fail-open regression review.
- 来源：baseline `7f382af7`; branch `hunt/sol-r4fo-browser-ai-hold`; source PR, not merged when authored.
- 缺陷修复：the automatic browser Secure DNS verdict used explicit disarm after #760, bypassing #1048's AI-preserving failure release. It now requests the existing selective disposition; finding `R4FO-MAC-BROWSER-AI-HOLD` (P1).
- 新增/优化：none; immediate ordinary-network recovery, browser error/classification and no automatic reconnect remain the existing behavior.
- 工程与测试：strengthen the existing production monitor/disconnect regression to require releaseAfterFailure rather than explicit disarm.
- 验证：Linux `git diff --check` and findings parser; native XCTest/Swift and installed PF/resolver behavior cannot run here and require hosted macOS CI/hardware. No native failing/passing run claimed.
- 候选/发布：仅源码，无新候选; no deploy or publication.
- 剩余限制：existing selective DNS/cache limitations; the independent pending-native-update/browser-conflict combination remains outside this focused normal-session correction.
