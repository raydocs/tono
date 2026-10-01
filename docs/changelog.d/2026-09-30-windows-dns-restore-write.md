## 2026-09-30 · Windows DNS restore continues after a bookkeeping write failure
- 归属：SHIP_PLAN §2 item 10; Windows service DNS recovery.
- 来源：origin/main `945bf1fa` → branch `hunt/sol-r3dns-restore-write`, this PR; not yet merged.
- 缺陷修复：WIN-DNS-RESTORE-SNAPSHOT-WRITE (P1): rewriting restore outcome flags could fail after adapter restoration and skip NRPT/DoH cleanup or prevent WFP disarm. Prove restoration before bookkeeping and omit the rewrite on success; save failed-proof flags best effort. A late replacement therefore cannot recreate a successfully retired snapshot on this path.
- 新增/优化：无; no change to strict-mode admission, DNS proof predicates, AI rules, or normal protected routing.
- 工程与测试：one facade regression blocks the temporary snapshot rewrite, checks refusal while DNS remains protected, then checks proven restore and policy cleanup with the write still blocked.
- 验证：Linux Rust 1.98.1; regression failed before the fix (`Is a directory`, 0 passed/1 failed). `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib core::dns::tests::`: 59 passed, 0 failed; `git diff --check` passed. Windows native code and real DNS/WFP were not run here.
- 候选/发布：仅源码，无新候选; no deployment/publication.
- 剩余限制：needs-hardware for disk-error recovery with actual DNS/WFP; existing restore-proof limitations remain.
