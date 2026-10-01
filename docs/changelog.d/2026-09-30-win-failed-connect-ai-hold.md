## 2026-09-30 · Preserve the AI hold in guarded Windows connect-failure release
- 归属：SHIP_PLAN §2 item 10; Windows failed-connect/cold-switch cleanup.
- 来源：baseline `1fb29265` → branch `hunt/sol-r3wconn-failed-connect-ai-hold`; source PR, not yet merged when authored.
- 缺陷修复：a failed protected cold switch performed one plain release and omitted the secondary AI hold. Its existing armed-release branch now requests applying-narrow cleanup while transferring the writer it already owns. Finding `WIN-CONNECT-FAILURE-AI-HOLD-OMISSION` (P1), separate from #798.
- 新增/优化：none. Strict/selective decisions, explicit user release, detached reconciliation and ordered DNS/Core/WFP cleanup retain their existing behavior.
- 工程与测试：one regression checks the real Tokio writer remains owned during dispatch, the AI-hold bit is requested, refusal is propagated and settled ownership is relinquished.
- 验证：Linux/Rust 1.98.1, CARGO_BUILD_JOBS=2, exact extracted production helper and regression: baseline-equivalent `false` failed (0 passed, 1 failed); fixed `true` passed (1 passed, 0 failed). `git diff --check` passed. Native Tauri/App and Windows WFP/NRPT/device checks cannot run here; hosted CI required.
- 候选/发布：仅源码，无新候选; no deploy or publication.
- 剩余限制：existing narrow layer remains best-effort with documented DNS/cache limits; dispatch/ownership evidence does not prove native network behavior. #798's independent second-release and stale-selection changes are untouched.
