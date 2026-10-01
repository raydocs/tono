## 2026-10-01 · Windows health proofs wait for published hot switches to settle
- 归属：SHIP_PLAN §2 item 10; Windows connection lifecycle.
- 来源：origin/main 64e8b593; hunt/sol-r4fws-switch-health-entry / #1150; follow-up to merged #1133, source PR not yet merged.
- 缺陷修复：same #1093/#1095 finding, second timing window: B was published but the controller still used A when health captured its context. Ordinary in-place health work now defers while the registered switch is pending; the next tick can prove settled B. The earlier captured-A/changed-B release guard remains. Capture/compare the registered switch task identity also rejects old A requests after A→B→A or proved rollback.
- 新增/优化：无。Forced protection/policy recovery retains its authority; AI hold and strict disposition are unchanged.
- 工程与测试：two new actual capture/admission regressions plus the earlier regression; no CI/dependency changes.
- 验证：Linux Rust 1.98.1 exact helper/test/FSM/lock fixture: new case before 0 passed / 1 failed (“a proof begun on old A after B publication must not release verified B”), after 24 fixture tests passed; the additional same-exit case then failed before its ID fence (0 passed / 1 failed, “an intervening switch must retire the old A proof even after selection returns to A”) and all 25 tests pass after (3 health regressions + portable FSM tests). git diff --check and targeted Rust syntax parsing passed. Native Windows/Tauri/switch/WFP/DNS acceptance unrun locally.
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：needs-hardware. The initial #1133 Windows CI was green but did not exercise this proof-start window; this continuation preserves that limitation and adds coverage.

2026-10-01 continuation: native Windows Rust CI on fe087b0c failed to compile the new ABA test (E0433, its selective test imports omitted Duration; Linux fixture had supplied it). Qualify std::time::Duration and remove that extra fixture import. The corrected three health regressions pass locally. This is a test compilation/fixture correction, not another customer bug; no gate or skip changed. Native rerun remains required.
