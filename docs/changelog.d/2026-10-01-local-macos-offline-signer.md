## 2026-10-01 · Obtain the macOS local release signer independently
- 归属：SHIP_PLAN §2 item 10；macOS release tooling.
- 来源：main `6adbc1b8` → `hunt/sol-r4rel-macos-offline-signer`; not yet merged.
- 缺陷修复：local release searched the empty App package graph for Sparkle's offline signer and could not finish on a fresh tree. It now downloads the same version/checksum-pinned archive used by the hosted workflow, verifies before extraction and discovers the modern signer in a fresh directory.
- 新增/优化：无；release gate, notarization and archive/feed signature verification remain required.
- 工程与测试：one offline regression executes only the production signer-acquisition block against command adapters and the real finder; it covers an empty App package graph and excludes the legacy DSA tool.
- 验证：Linux Python; baseline regression 0 passed / 1 failed; signer 7, notarization 6, release-gate core 1 tests passed. Native zsh/macOS tools and signed packaging unavailable here. Bash cannot parse either baseline or changed complete zsh script; only the extracted acquisition block ran.
- 候选/发布：仅源码，无新候选；no build/release, deployment, publication or keys accessed.
- 剩余限制：the offline adapters verify command boundaries and pin values; they do not download or validate native signer bytes.
