## 2026-09-30 · macOS automatic catalog/policy cleanup retains AI hold
- 归属：SHIP_PLAN §2 item 10; macOS catalog, switch and optional-policy recovery.
- 来源：origin/main `e925181a` → `hunt/sol-r4sw-mac-catalog-ai-hold`; PR #1103; source only.
- 缺陷修复：#963/#966 automatic failure callers now use existing AI-preserving release while restoring ordinary internet. They no longer invoke full user disarm.
- 新增/优化：无；existing helper operation, strict branches, explicit Restore and teardown order retained; no helper contract or UI change.
- 工程与测试：three narrow actual AppState catalog/switch regressions and one strengthened actual optional-policy failure regression assert AI hold and zero full disarms. Existing test privileged boundary now also stubs automatic release.
- 验证：diff whitespace and focused caller source assertions passed. Swift/XCTest unavailable on Linux; hosted macOS CI required. Baseline runtime branches select disarm/aiHold=false; no native red/green execution claimed here.
- 候选/发布：仅源码，无新候选；no deploy/publish.
- 剩余限制：needs-hardware for AI domains/Claude IPs after catalog/policy failure; pending-update transport owned by #1099.
