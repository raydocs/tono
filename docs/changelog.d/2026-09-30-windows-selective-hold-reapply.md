## 2026-09-30 · Windows selective AI hold refresh preserves existing protection
- 归属：SHIP_PLAN §2 item 10; Windows Service selective fallback.
- 来源：baseline `89a0e0e7`; branch `hunt/sol-r4ks-selective-reapply`; PR pending, source only.
- 缺陷修复：a repeated hold request deleted active AI rules before re-adding them. Apply now updates fixed firewall/NRPT rules in place; successful firewall updates avoid duplicate additions.
- 新增/优化：无; general traffic, the suffix/prefix allowlist, strict policy and explicit Restore stay unchanged.
- 工程与测试：one repeated-apply regression; existing late-cleanup test now pauses an explicit removal before requesting a replacement hold. Prefix-only safety coverage includes fixed set vectors and rejects a broad set.
- 验证：Linux Rust 1.98.1; repeated-apply regression failed before; selective tests 7 passed, WFP tests 111 passed using `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib <module>`; `git diff --check` passed. Native Windows command/packet execution unrun.
- 候选/发布：仅源码，无新候选; no deploy or publish.
- 剩余限制：needs-hardware; native failures/hangs, orphan children across Service death, and DNS/cache coverage are unchanged limits. Durable release disposition is tracked separately in #1077.
