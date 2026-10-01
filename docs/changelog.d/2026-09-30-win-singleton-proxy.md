## 2026-09-30 · Windows singleton notification reaches the local app directly
- 归属：SHIP_PLAN §2 item 10; Windows app startup/reopening reliability.
- 来源：origin/main `c2c8eb75` → branch `hunt/sol-winapp-singleton-proxy`; source PR, not merged at authoring.
- 缺陷修复：WIN-SINGLETON-INHERITED-PROXY (P3): inherited HTTP proxy settings intercepted the local existing-instance notification and a second launch failed after 20 seconds; the notification now uses a direct loopback client.
- 新增/优化：无; singleton lock, authentication, binding, deadlines, window presentation and connection policy are preserved.
- 工程与测试：one isolated-child regression sends the authenticated visible command through the production notifier despite inherited proxy variables; parallel tests retain their own environment.
- 验证：Linux Rust 1.98.1, `CARGO_BUILD_JOBS=2`, portable extraction of production notifier/test with the repository's reqwest 0.13.5 and hyper-util 0.1.20: baseline failed, fixed test passed (1 passed). Harness enables HTTP/query/system-proxy features; no TLS handshake is involved. `git diff --check` passed. Full Tauri and Windows-native checks require hosted CI.
- 候选/发布：仅源码，无新候选，无部署/发布。
- 剩余限制：no installed Windows second-launch capture; existing primary app and normal network were not disrupted by the original bug.
