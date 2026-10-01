## 2026-10-01 · Windows API tunnel preserves server errors
- 归属：SHIP_PLAN §2 item 10; Windows account transport reliability.
- 来源：baseline `718eda43`; branch `hunt/sol-r4wapp-tunnel-server-response`; not merged at authoring.
- 缺陷修复：direct API paths failing plus a genuine tunneled origin 503 previously became an unreachable-control-plane error and lost the answer counter; the response now retains its status, body and evidence.
- 新增/优化：none; production TLS validation and transport retry rules are unchanged.
- 工程与测试：one real loopback CONNECT/TLS regression exercises the production request/response reader and tunnel-result fold; its public localhost certificate is trusted only by the test client.
- 验证：Linux production-source fixture failed before at “an origin 503 must end the fallback walk” and passed after; exact dependency versions, command and native limitations are recorded in the PR. `git diff --check` and Rust syntax parsing passed.
- 候选/发布：source only; no new candidate, deploy or publication.
- 剩余限制：native Windows/Tauri CI remains required. No ordinary-UI offline-admission bypass or device qualification is claimed.
