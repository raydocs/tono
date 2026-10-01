## 2026-09-30 · macOS automatic failure retains the AI hold
- Ownership: SHIP_PLAN §2 item 10; macOS connection recovery and helper release contract.
- Source: baseline `3853f5ec`; branch `hunt/sol-r3p1m-ai-failure-hold`, this PR; source delivery only, not yet merged.
- Fix: exhausted armed recovery releases ordinary traffic through a separate authenticated helper intent, retaining the existing AI resolver/Claude-route floor instead of removing it as an explicit Disconnect.
- Added/optimized: none. Explicit release and shared strict disposition retain their existing semantics.
- Engineering/tests: one actual-path XCTest regression updated; existing monitor/reconnect fixtures stub the added helper I/O. Helper protocol is bumped and CONTRACT.sha256 regenerated from the build script's exact ordered source manifest.
- Verification: Linux `git diff --check` and findings parser; independent read-only review. Swift/XCTest, helper compilation and native PF/DNS behavior unavailable here; hosted macOS CI and `needs-hardware` acceptance required.
- Candidate/publication: source only, no new candidate, deploy or publication.
- Remaining limits: existing narrow-layer best-effort application and domain coverage; DashScope needs a separate coordinated policy/recovery change.
