## 2026-09-30 · Windows abandoned Connect deadline
- 归属：SHIP_PLAN §2 item 10; Windows Service reliability.
- 来源：`ad53abb6` → branch `hunt/sol-r3ks1-bootstrap-proof-window`; this PR, not yet merged.
- 缺陷修复：An App crash between StartClash and verification could leave healthy Bootstrap WFP blocking ordinary internet indefinitely. A Service-owned seven-minute proof window now stops and retires that exact unfinished Core, restores DNS, releases general WFP, and applies the existing narrow AI hold.
- 新增/优化：No new product feature. Completed verification cancels the deadline; epoch/lifecycle admission protects newer connections; strict protection remains excluded.
- 工程与测试：Four narrow regressions: abandoned verification, verification completion, successor fencing, and strict preservation.
- 验证：Linux Rust 1.98.1, `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib core::windows_kill_switch::tests -- --test-threads=1`: 98 passed. The initial regression first failed on the missing Service window. Native Windows build and installed networking not run here.
- 候选/发布：仅源码，无新候选；no deploy or publication.
- 剩余限制：The cap gives the legal 310-second cold Connect time to finish. Additional Core-stop, persistent-state, DNS or WFP failures still need retry/real-device evidence; needs-hardware.
