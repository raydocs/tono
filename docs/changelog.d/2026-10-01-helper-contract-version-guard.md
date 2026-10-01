## 2026-10-01 · Helper contract guard rejects a matching hash with contradictory version metadata
- Ownership: ops plan (docs/ops/plan-2026-09-11.md), build validation; not a ship gate.
- Source: branch `claude/fix-1152-helper-contract-guard`; fixes #1152 (R4MH-CONTRACT-METADATA-MISMATCH).
- Defect fix: `build-core-helper.sh` rejected only a changed hash under an unchanged version. A `CONTRACT.sha256` whose hash matched the sources but whose recorded version differed from `HelperProtocolVersion.current` (a collision resolver advancing only the record) was accepted and then rewritten. It is now rejected; the fresh-version/stale-hash path still builds. No helper source, `HelperProtocolVersion.swift` or `CONTRACT.sha256` value changes, so no protocol bump.
- Engineering/tests: `tooling/scripts/test-core-helper-contract-guard.sh` runs the real script in a mirror tree with a fake `xcrun` (nothing compiled) and is wired into `macos-ci.yml` policy-tests. It failed on the old guard.
- Verification: the script passes locally on the new guard and fails on the old one at the mismatched-version case. The native helper build was not run (CI runs it).
- Candidate/publication: source only, no new candidate, deploy or publication.
