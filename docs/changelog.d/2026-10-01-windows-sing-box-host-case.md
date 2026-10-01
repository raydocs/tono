## 2026-10-01 · Windows sing-box DIRECT hosts are emitted as one lowercase key
- 归属：SHIP_PLAN §2 item 10; Windows sing-box runtime compiler (tono-core).
- 来源：origin/main b316a9a3; fix/win-1260-direct-host-case; source PR, not yet merged.
- 缺陷修复：#1260, a DirectPlan with `qq.com` and `QQ.com` compiled into two `predefined` keys that Service admission (Go key folding) refuses, so connect failed. The compiler now lowercases host keys and merges their addresses; admission stays strict.
- 新增/优化：无。
- 工程与测试：one `#[test]` checks the compiler emits a single lowercase `predefined` key with both addresses.
- 验证：rustfmt check of the changed hunks passed locally; `cargo test` not run on this Mac (owner rule), hosted CI runs it.
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：the route rule `domain` value keeps the plan's spelling; installed connect behavior needs hardware (needs-hardware).
