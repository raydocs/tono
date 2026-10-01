## 2026-10-01 · Preserve HY2 pins through catalog relisting
- 归属：SHIP_PLAN §2 item 10; control-plane catalog / macOS HY2 admission.
- 来源：main `d3a38043` → branch `hunt/sol-r4fmc-hy2-relist-spki`; PR pending.
- 缺陷修复：#1073 DER-only reconstruction stripped the macOS SPKI pin; require a complete operator-issued HY2 block before publishing a missing sibling and preserve existing blocks.
- 新增/优化：bounded catalog_relist template parameters; managed placeholders checked before queue persistence. No certificate-verification change.
- 工程与测试：one failing-before/passing-after Worker retire/relist regression; one pre-persistence identity boundary test prevents credential-bearing job parameters in the newly added path.
- 验证：Linux/cached Node24; npm ci, typecheck, focused Worker/catalog tests (24 passed), ops budgets/purity and git diff --check passed. Native macOS connection not run.
- 候选/发布：仅源码，无新候选；no deployment/publication.
- 剩余限制：profiles cannot derive SPKI; operators must provide the original complete block. Installed HY2 acceptance remains needs-hardware.
