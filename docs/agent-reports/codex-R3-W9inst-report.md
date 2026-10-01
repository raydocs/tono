Fixed one P1 in [#1042](https://github.com/raydocs/tono/pull/1042), merged as `6b2be353`. Failed native updates now release ordinary internet after rollback while preserving the AI hold. Strict blocking remains intact.

Locations below refer to baseline `4ef4bf74`; full paths and evidence are in the [audit report](/workspace/w1-codex/out/R3-W9inst/report.md).

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-UPDATE-ROLLBACK-UNVERIFIED-HOLD | W9 | P1 | update_executor.rs:521 | Successful rollback retains an unverified full block | Fixed in #1042 |
| W9-DEFERRED-PARTIAL-STAGE | W9 | P2 | install_service.rs:81 | Later failed staging can corrupt a queued reboot candidate | Real-unfixed; multiple failures, native verification pending |
| W9-RESOURCE-CANCEL-REPAIR | W9 | P2 | app/installer.nsi:1461 | Cancelled retry can expose mismatched repair resources | Real-unfixed; multistep trigger, native verification pending |
| W9-TARGET-PUBLICATION-CLOCK | W9 | P2 candidate | update_executor.rs:375 | Complete-target recovery may omit publication floor | Unconfirmed; ordinary impact unproved |
| W9-DUP-SCM-RECOVERY | W9 | P2 | update_executor.rs:558 | Recovery configuration failure bypasses restart | Duplicate BRICK-W9 |
| W9-DUP-SERVICEONLY-ROLLBACK | W9 | P2 | install_service.rs:2071 | Service-only repair lacks predecessor backup | Duplicate #815 |
| W9-DUP-RECOVERY-TASK | W9 | P2 | update_executor.rs:415 | Task-registration failure leaves pending rollback | Duplicate X3-2-order/#488 |
| W9-FP-VERIFIED-ROLLBACK | W9 | — | windows_kill_switch.rs:3277 | Verified rollback retains full block | False positive; startup releases it |
| W9-FP-LEGACY-JOURNAL | W9 | — | install_service.rs:1305 | Legacy journal blocks native recovery | False positive; no production caller |
| W9-FP-DIGEST-PIN | W9 | — | install_service.rs:1995 | New pin poisons predecessor recovery | False positive; compiled pin wins |
| W9-FP-UPGRADE-TIMEOUT | W9 | — | app/installer.nsi:824 | Timeout kills coordinated rollback | False positive; upgrade has no outer timeout |
| W9-FP-RETRY-LOOP | W9 | — | app/installer.nsi:835 | Installer retries indefinitely | False positive; retries capped |
| W9-FP-UPDATE-FLAG | W9 | — | app/installer.nsi:872 | Raw UPDATE flag controls preservation | False positive; validated installation evidence controls it |
| W9-FP-JOURNAL-RETRY | W9 | — | app/installer.nsi:845 | Journal refusal automatically retries | False positive; exit 76 aborts |
| W9-FP-LEGACY-NSIS | W9 | — | service/installer.nsi:18 | Legacy installer deletes recovery files | False positive; template unused |
| W9-FP-PRIVATE-UNPACK | W9 | — | app/installer.nsi:1203 | Private extraction changes installed product | False positive; gates and early returns prevent mutation |
| W9-FP-RESOURCE-ROLLBACK | W9 | — | app/installer.nsi:1273 | Immediate repair installs mixed generations | False positive; retained lease blocks repair |
| W9-FP-NARROW-RESTART | W9 | — | windows_kill_switch.rs:3371 | Restart erases the AI hold | False positive; separate rules survive |

**PR status:** #1042 merged through merge-commit auto-merge; `needs-hardware` applied; [full CI gate passed](https://github.com/raydocs/tono/actions/runs/36815189282). Regression failed before and passed after; portable installer tests: **17 passed**.

**Examined:** 18 hypotheses; **11 false positives** and 3 duplicates.

All assigned files were reviewed. Unfinished: installed-device acceptance and verification of the lower-priority candidates. Handoff files: [findings.tsv](/workspace/w1-codex/out/R3-W9inst/findings.tsv), [prs.tsv](/workspace/w1-codex/out/R3-W9inst/prs.tsv).