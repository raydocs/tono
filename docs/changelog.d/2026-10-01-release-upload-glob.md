## 2026-10-01 · Honor release uploader installer globs
- 归属：SHIP_PLAN §2 item 10；release asset tooling.
- 来源：main `14347158` → `hunt/sol-r4rel-upload-glob`; not yet merged.
- 缺陷修复：documented --pattern glob used substring matching and rejected matching installers. It now uses Node's native glob matcher.
- 新增/优化：无；default extension selection, artifact names, bytes and publish gates remain unchanged.
- 工程与测试：one offline CLI regression supplies matching metadata through fake gh and refuses at the download boundary, before any upload.
- 验证：Linux Node 20.19.2; baseline 0 passed / 1 failed, fixed 1 passed / 0 failed; node --check and git diff --check pass. CI uses Node 24.
- 候选/发布：仅源码，无新候选；no real download, publish, deployment or bucket write.
- 剩余限制：the local fixture proves selection, not real artifact upload/serving acceptance.
