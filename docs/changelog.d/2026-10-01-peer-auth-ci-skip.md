## 2026-10-01 · helper 对等授权不再把缺证书当成通过

- 归属：SHIP_PLAN macOS helper 身份门。不是 G4。不改授权要求本身。
- 来源：`origin/main` `236d76cd` → 本分支；Fixes [#956](https://github.com/raydocs/tono/issues/956)；[#964](https://github.com/raydocs/tono/pull/964)；未合 main。
- 缺陷修复：`test-helper-peer-authorization.sh` 在找不到 `Apple Development: Ruirui Wan` 时退出 0。`macos-ci` 跑拒绝用例，并用 warning 和 job summary 写明放行用例没跑。`macos-release` 在导入 Developer ID 之后，用那张身份跑生产要求的放行用例；钥匙串里没有这张身份才失败。
- 新增/优化：无。临时钥匙串里的自签身份只用于 CI 的额外拒绝用例。生产要求仍是 `anchor apple generic`、标识 `com.raydocs.tono`、OU `YY57758GS7`、且没有 `get-task-allow`。Developer ID 与 Apple Development 带同一个团队 OU，这条要求不排除 Developer ID。
- 工程与测试：`tooling/scripts/tests/peer-auth-mode.test.mjs`。修复前发布模式到不了这个判定（本机没有 `xcrun`，退出 127）。修复后 2 tests OK。
- 验证：`node --test tooling/scripts/tests/peer-auth-mode.test.mjs` 2 tests OK。`sh -n` 通过。没有在本机跑 `swiftc` / `codesign`。本机缺身份时 `--plan` 的 local 模式仍是 SKIP、退出 0。
- 候选/发布：仅源码，无新候选。
- 剩余限制：托管 `macos-ci` 没有开发证书，放行用例在 CI 里仍不执行。自签失败时只跑 ad-hoc 拒绝，并再写一条 warning。发布步骤改在 Developer ID 导入之后，不再因为缺少 Apple Development 身份而失败。

## 2026-10-01 · 续记

- 工程与测试：`macos / policy-tests` 在第四次重签 `auth-client` 后退出 1，没有别的报错。ad-hoc 拒绝和「自签、正确标识、无 entitlement」共用 `reject-com.raydocs.tono-0.sock`。服务端用 `exit()`，Swift 的 defer 不会删套接字，下一次把残留文件当成已在监听。每个用例改为 `cN.sock`。授权要求没有改。
