## 2026-10-01 · Windows automatic releases install the AI hold before removing WFP
- 归属：SHIP_PLAN §2 item 10; Windows kill switch / selective AI hold (decision 031).
- 来源：origin/main 7a1a3a5a; fix/win-ai-hold-before-wfp-release-1271; source PR, not yet merged.
- 缺陷修复：#1271, automatic non-strict releases (watchdog, crash window, startup recovery, automatic Service stop, failed-update emergency disarm) removed every provider WFP filter and only then requested the AI hold, so AI traffic could go direct in between, and a failed hold was only logged. Each such release now installs and confirms the AI hold while WFP still blocks, then removes WFP; the post-removal follow-up still runs at the durable tombstone boundary, so a process death there still replays the hold on the next start.
- 新增/优化：`selective_layer::finish_release` reports whether the hold landed within its budget. A failed or slow hold never keeps the general block: WFP is still removed, and the failure is logged and appended to `last_error`. Strict mode and explicit Restore/Disconnect (no AI hold) are unchanged.
- 工程与测试：one regression (`automatic_release_installs_the_ai_hold_before_removing_wfp`) records whether the hold was active at the WFP removal of a watchdog release. Two interruption tests now drop the native hold explicitly to model it dying with the process, since it lands before WFP removal.
- 验证：rustfmt --edition 2024 --check: no diffs on the changed lines (pre-existing diffs elsewhere in both files untouched). cargo test runs on hosted windows CI only.
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：the hold adds up to its 6 s wait before WFP removal while the operation lock is held; installed netsh/NRPT/WFP ordering needs real-hardware verification.
