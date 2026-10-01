## 2026-10-01 · Windows sing-box optional fingerprint compatibility
- 归属：G1 / shared Rust core; Windows connection preparation.
- 来源：`ad8ab2cd` → branch `hunt/sol-r4core-singbox-fingerprint`; PR pending, not yet merged.
- 缺陷修复：A valid admitted VLESS node without `client-fingerprint` rejected the entire sing-box catalog → omission uses the existing Chrome product default. Finding `R4CORE-SINGBOX-OPTIONAL-FINGERPRINT`.
- 新增/优化：None; explicit unsupported values remain rejected and protection rules are unchanged.
- 工程与测试：One regression exercises omission on an unselected admitted node and checks Chrome, Reality and verified TLS emission.
- 验证：Linux/Rust 1.98.1, `CARGO_BUILD_JOBS=2 cargo test -p tono-core`: 337 unit + 15 integration tests passed. Regression failed before the fix with `UnsupportedFingerprint`; `git diff --check` passed. Existing unused constant warning remains.
- 候选/发布：仅源码，无新候选; no package, deployment or publication.
- 剩余限制：Windows app/service and real sing-box/TUN/WFP startup cannot run in this VM. Requires authenticated installed sing-box; existing missing-binary fallback remains. CI and hardware acceptance pending.
