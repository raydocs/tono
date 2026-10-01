## 2026-09-30 · Windows uploaded audit segments redact account identifiers
- 归属：SHIP_PLAN §2 item 10; Windows diagnostic privacy.
- 来源：origin/main `d7e24ec9` → branch `hunt/sol-winapp-upload-identifier-redaction`; source PR, not merged at authoring.
- 缺陷修复：WIN-LOG-UPLOAD-IDENTIFIERS (P2): scoped raw-log segments included the account email and revoked-device identifier; uploaded rows now redact them while keeping authorized routing evidence.
- 新增/优化：无; private local audit data and the existing collection-window/consent boundary are preserved.
- 工程与测试：one upload-boundary regression checks identifiers, routing evidence, original-byte cursor and unchanged local file; audit comment now describes the actual upload boundary.
- 验证：Linux Rust 1.98.1, extracted production queue/segment/gzip/redactor and checked-in reader tests: before 0 passed/1 failed (email present), after all 9 passed in 0.74s. `git diff --check` passed. Full Tauri/Windows-native suite not runnable here; hosted Windows CI required.
- 候选/发布：仅源码，无新候选，无部署/发布。
- 剩余限制：operator-authorized hostnames, destination IPs, process and route evidence intentionally remain in raw support logs; native upload flow not tested on a real Windows device.
