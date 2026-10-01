## 2026-10-01 · Windows sing-box DIRECT replacement waits for the new adapter before locking
- 归属：SHIP_PLAN §2 item 10; Windows Service sing-box DIRECT replacement (round-2 Windows App hunt, end-to-end connect flow).
- 来源：origin/main 626b1d74; branch hunt/claude-r2-win-singbox-lock-retry; source PR, not yet merged.
- 缺陷修复：WIN-SINGBOX-REPLACE-LOCK-RACE, `replace_running_sing_box_document` locked the tunnel once right after spawning sing-box, before its WinTUN adapter existed; the "did not resolve to a LUID" refusal sent it through the restore (same race) to a general-traffic release with the AI hold, and the monitor's reconnect repeated the cycle. All three locks in the replacement now retry only the adapter-not-ready refusals, 50 × 200 ms like the App's connect lock.
- 新增/优化：无。Other lock failures, the restore and the release-with-AI-hold fallback are unchanged; no wire or protocol change.
- 工程与测试：one regression (`a_replacement_lock_waits_for_the_new_sing_box_adapter`).
- 验证：cargo test not run locally (MacBook rule); hosted CI runs it. rustfmt --check: no diff on the changed lines (one pre-existing drift in the file).
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：needs-hardware: the real adapter timing after a sing-box kill and respawn.
