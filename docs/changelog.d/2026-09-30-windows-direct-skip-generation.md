## 2026-09-30 · Windows old DIRECT discovery preserves successor evidence
- 归属：SHIP_PLAN §2 item 10; Windows connection lifecycle reliability.
- 来源：baseline `6a9994ca`; branch `hunt/sol-r4wapp-direct-skip-generation`; not merged at authoring.
- 缺陷修复：a delayed optional DIRECT resolution failure previously cleared a newer session's overlay/uplink evidence and logged against its account; generation-fenced skips now discard the predecessor result.
- 新增/优化：none; current-session optional failures still retain the full-tunnel fallback.
- 工程与测试：one regression checks successor active/interface/skip evidence after an old generation reports discovery failure.
- 验证：Linux exact production-function fixture failed before (`a predecessor cannot disable the current overlay evidence`), passed after; `git diff --check` and Rust parsing pass. Full native Windows/Tauri and installed network behavior not run here.
- 候选/发布：source only; no new candidate, deployment or publication.
- 剩余限制：requires overlapping old discovery and successor connection (P2). `needs-hardware`; no WFP/DNS permit changes.
