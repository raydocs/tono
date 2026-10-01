## 2026-09-30 · Windows cancelled Quit keeps successor connection state
- 归属：SHIP_PLAN §2 item 10; Windows lifecycle reliability.
- 来源：baseline `42775907`; branch `hunt/sol-r4wapp-quit-resync-generation`; not merged at authoring.
- 缺陷修复：a delayed cancelled-Quit/update Service response could clear a successor connection and stop its health supervision; the fold now checks its captured connection generation under the state mutex.
- 新增/优化：none; current-state monitor setup and catalog refresh restart still run after discarding an old response.
- 工程与测试：one narrow delayed-disarm regression uses the production fold and the real portable connection FSM.
- 验证：Linux extracted production functions: failed before with successor state `(false, false, false)`, passed after with `(true, true, true)`; `git diff --check` and Rust parsing pass. Native Windows/Tauri and installed network lifecycle not run here.
- 候选/发布：source only; no new candidate, deployment or publication.
- 剩余限制：requires an overlapping response and successor admission (P2). Label `needs-hardware`; hosted CI does not replace installed-device acceptance.
