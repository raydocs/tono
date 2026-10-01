## 2026-10-01 · Preserve Mihomo proxy mappings with bracketed node names
- 归属：SHIP_PLAN §2 item 10 / G1；Windows shared core runtime generation.
- 来源：origin/main `64e8b593` → branch `hunt/sol-r4core-yaml-sequence-maps`; PR pending; source only.
- 缺陷修复：a valid catalog name such as `Tokyo [primary]` caused the YAML quoting pass to quote a proxy mapping opener as a scalar and produce invalid runtime YAML. Mapping openers now remain intact. Finding `R4CORE-YAML-MAPPING-QUOTE`.
- 新增/优化：无；rule targets, DNS, WFP, assistant protection and strict-mode behavior are unchanged.
- 工程与测试：one admitted-input regression checks both runnable and redacted YAML mappings.
- 验证：Linux, Rust 1.98.1; the new regression failed before the fix with `generated YAML must parse` and a parser error at line 50. `CARGO_BUILD_JOBS=2 cargo test -p tono-core` passed after the fix: 337 unit and 15 integration tests, no failures. `git diff --check` passed. Existing unused-constant warning remains.
- 候选/发布：仅源码，无新候选；未部署或发布。
- 剩余限制：Windows/Tauri/service and installed-device startup unrun locally; covered by hosted CI and needs-hardware acceptance. Current publication rejects new bracketed names; retained legacy catalogs/caches still admit them. No production inventory inspected. The default sing-box path is unaffected; this fixes explicit Mihomo and eligible binary fallback.
