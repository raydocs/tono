## 2026-09-30 · Preserve the AI hold after Windows health recovery
- 归属：SHIP_PLAN §2 item 10; Windows App automatic connection-health recovery.
- 来源：baseline `2a7d73d7` → branch `hunt/sol-r3wconn-monitor-ai-hold`; source PR, not yet merged when authored.
- 缺陷修复：an ordinary failed exit/TUN proof selected plain user release and removed the secondary AI hold; automatic recovery now selects the existing applying-narrow release. Finding `WIN-MONITOR-AI-HOLD-OMISSION` (P1).
- 新增/优化：none. The shared strict/policy-rebuild disposition, explicit user release, ordered DNS/Core/WFP teardown and detached cleanup ownership retain their existing behavior.
- 工程与测试：one regression at the production health-release dispatch boundary, including refusal propagation and protected-path exclusions.
- 验证：Linux/Rust 1.98.1 extracted production dispatcher and its exact regression against real tono-core: baseline-equivalent `false` failed (0 passed, 1 failed); fixed `true` passed (1 passed, 0 failed). `cargo test --locked -p tono-core unarmed_probe::tests::`: 3 passed. `git diff --check` passed. Native Tauri compilation and Windows WFP/NRPT/device tests cannot run in this VM and remain CI/hardware work.
- 候选/发布：仅源码，无新候选; no deploy or publication.
- 剩余限制：the existing narrow layer has documented best-effort DNS/cache limitations. This verifies selecting it after health loss, not expanding its coverage or proving native networking.
