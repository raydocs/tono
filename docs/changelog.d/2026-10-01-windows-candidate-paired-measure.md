## 2026-10-01 · Paired Windows candidate measures the installed components
- Ownership: SHIP_PLAN §2 item 10; release-trust tooling (`desktop-update-candidate.yml` → `windows-candidate.yml`).
- Source: baseline `626b1d74`; branch `hunt/claude-r2-candidate-measure`; not yet merged.
- Defect fix: the paired unsigned candidate's Windows measurement searched the extracted NSIS package by file name. Since #658 the package also carries a `$PLUGINSDIR/tono-gate/` copy of every resource, so `tono-service.exe` matches twice and the step throws; and since #1159 the package ships `sing-box.exe`, which the Service compares as a fourth component, but the step never passed `--sing-box`. The step now uses `tooling/scripts/windows-package-components.mjs` (the selector `desktop-update-sign.yml` already uses) and passes `--sing-box` when the package carries it.
- New/optimization: none.
- Engineering/tests: no new test; the selector's existing test covers gate copies and `sing-box.exe.next` (`node --test tooling/scripts/tests/windows-package-components.test.mjs` 1/1 passed). Workflow YAML parses (Ruby `YAML.load_file`).
- Verification: the paired step only runs on `desktop-update-candidate.yml` dispatch (`update_release_sequence` set). That workflow has never run, so the step is unexercised by `ci-gate`.
- Candidate/publication: source only; no package, signing, deployment or publication.
- Limits: the paired manifest is still unsigned and is not update authority.
