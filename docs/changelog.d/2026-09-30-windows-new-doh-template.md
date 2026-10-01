## 2026-09-30 · Windows preserves DoH settings on adapters appearing mid-session
- 归属：SHIP_PLAN §2 item 10; Windows service DNS original-state restoration.
- 来源：origin/main `0484176a` → branch `hunt/sol-r3dns-doh-new-template`, this PR; not yet merged.
- 缺陷修复：WIN-DNS-DOH-NEW-TEMPLATE (P2): a new enabled DoH template was suppressed while an older readable capture stayed unchanged, so Disconnect could not put its flags back. Append new identities durably before mutation, preserving existing originals.
- 新增/优化：无; no protected DNS/WFP/AI rule changes; capture write failure prevents that suppression.
- 工程与测试：one Windows native-engine regression adds an IPv6 template mid-session, observes the actual durable capture before the first flag write, and verifies restoration of both adapters. Fixture-only numeric reads prevent host registry effects.
- 验证：rustfmt syntax parsing of changed Rust files and `git diff --check` passed on Linux. Windows production-config regression cannot execute here; existing native-DNS CI job runs its module. No local native pass claimed.
- 候选/发布：仅源码，无新候选; no deployment/publication.
- 剩余限制：needs-hardware for adapter changes, disconnect and installed DoH readback. Capture retirement is separately addressed in #985.
