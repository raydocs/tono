## 2026-09-30 · macOS Quit AI-hold decision item

- 归属：SHIP_PLAN §2 item 10; macOS Quit and helper release policy.
- 来源：origin/main `72a9c98db24f5b3f5ad30a1be7191ce17a0df0be`; branch `hunt/sol-r3quit-ai-hold-decision`; not merged at authoring.
- 缺陷修复：none. MAC-QUIT-AI-HOLD is reverified, but the documented explicit Disconnect full-release exception requires policy reconciliation before changing Quit.
- 新增/优化：finding record traces successful Quit through the helper and distinguishes Windows explicit Quit from automatic recovery and Service stop.
- 工程与测试：docs only; no runtime, helper protocol, contract, test or CI changes.
- 验证：source trace and two independent read-only audits; findings/changelog parsers and staged `git diff --check` passed. Swift/XCTest/helper self-tests and installed-device PF/DNS behavior not executed on this Linux host.
- 候选/发布：only documentation; no new candidate, deployment or publication.
- 剩余限制：normal successful Quit still removes the AI floor. Decision required on Quit versus explicit Disconnect; Restore network and strict-mode behavior unchanged. Docs-only PR must not auto-merge.
