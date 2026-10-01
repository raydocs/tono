## 2026-09-30 · Avoid App TCP probes behind retained Windows protection

- 归属：SHIP_PLAN §2 item 10; Windows cold switch and protected reconnect.
- 来源：origin/main `7f382af7` → `hunt/sol-r4sw-protected-tcp-preflight`; PR #1070; source only.
- 缺陷修复：a protected re-entry no longer sends an App-owned TCP proof that the retained Core-only WFP endpoint permission rejects. The regular protected startup transaction still proves the exit over Core/TUN; unarmed first connect and recovery retain the TCP gate.
- 新增/优化：无；no WFP permits or strict policy change.
- 工程与测试：one narrow regression, `protected_reconnect_does_not_open_an_app_tcp_probe`, uses real reconnect FSM state and a local TCP listener; protected startup must not create an App proof/cache entry.
- 验证：`git diff --check` and rustfmt syntax parse passed; source/WFP identity path traced. Native Tauri/Windows test unavailable on Linux; hosted Windows CI required.
- 候选/发布：仅源码，无新候选；no deployment/publication.
- 剩余限制：needs-hardware for HY2→VLESS switching and residential/policy rebuild after proof cache expiry.
