## 2026-10-01 · helper 对等授权不再把缺证书当成通过

- 归属：SHIP_PLAN macOS helper 身份门。不是 G4。不改授权要求本身。
- 来源：`origin/main` `236d76cd` → 本分支；Fixes [#956](https://github.com/raydocs/tono/issues/956)；[#964](https://github.com/raydocs/tono/pull/964)；未合 main。
- 缺陷修复：`test-helper-peer-authorization.sh` 在找不到 `Apple Development: Ruirui Wan` 时退出 0。`macos-release` 现在直接失败。`macos-ci` 跑拒绝用例，并用 warning 和 job summary 写明放行用例没跑。
- 新增/优化：无。临时钥匙串里的自签身份只用于额外的拒绝用例。生产要求仍是 `anchor apple generic`、标识 `com.raydocs.tono`、OU `YY57758GS7`、且没有 `get-task-allow`。
- 工程与测试：`tooling/scripts/tests/peer-auth-mode.test.mjs`。修复前发布模式到不了这个判定（本机没有 `xcrun`，退出 127）。修复后 2 tests OK。
- 验证：`node --test tooling/scripts/tests/peer-auth-mode.test.mjs` 2 tests OK。`sh -n` 通过。没有在本机跑 `swiftc` / `codesign`。本机缺身份时 `--plan` 的 local 模式仍是 SKIP、退出 0。
- 候选/发布：仅源码，无新候选。
- 剩余限制：托管 `macos-26` 没有这张开发证书，放行用例在 CI 里仍不执行。下一次 `macos-release` 会在这一步失败，直到该身份出现在钥匙串里。`ci-gate` 走 `macos-ci`，不会因此变红。自签失败时只跑 ad-hoc 拒绝，并再写一条 warning。
