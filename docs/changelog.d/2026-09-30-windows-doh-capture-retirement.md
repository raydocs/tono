## 2026-09-30 · Windows DNS release tolerates a locked restored DoH capture
- 归属：SHIP_PLAN §2 item 10; Windows service DNS recovery.
- 来源：origin/main `316df1b2` → branch `hunt/sol-r3dns-doh-retirement`, this PR; not yet merged.
- 缺陷修复：WIN-DNS-DOH-CAPTURE-DELETE (P1): a sharing violation deleting already-restored global or interface DoH captures used to refuse release. Record completed restoration durably when the capture is retained; continue the policy restore.
- 新增/优化：the retained capture cannot replay stale originals. A subsequent suppression captures current settings, then retires the completion record before changing DoH. Strict decisions and AI rules unchanged.
- 工程与测试：one native-engine lifecycle regression uses real Windows file-sharing locks and fixture-only registry effects; no host DNS changes. The fixture now reads numeric policy values and can opt into suppression without installing host NRPT rules.
- 验证：Linux Rust 1.98.1: portable DNS facade suite 58 passed/0 failed (native engine compiled out; not qualification of this fix). rustfmt syntax parsing and `git diff --check` passed. Native regression cannot run in this VM; existing Windows CI explicitly runs its production-config module.
- 候选/发布：仅源码，无新候选; no deployment/publication.
- 剩余限制：needs-hardware for DNS/WFP recovery with locked capture files. A second failure writing the completion record still returns an error; actual policy writes remain required.
