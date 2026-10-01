All eight fixes merged through green CI. The [full 107-row report](/workspace/w1-codex/out/W1-sol-win-app/report.md) includes every hypothesis, duplicate and false-positive reason.

Paths below are relative to the Windows app’s `src` or `src-tauri/src`.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-STATUS-LISTENER-LEAK | A10 | P3 | `services/tono.ts:861` | Repeated mounts leaked status listeners | Fixed [#820](https://github.com/raydocs/tono/pull/820) |
| WIN-DNS-CALLBACK-LIFETIME | A8 | P2 | `tono/windows_dns.rs:149` | DNS completion could outlive its allocation | Fixed [#828](https://github.com/raydocs/tono/pull/828) |
| WIN-DIRECT-RESTORE-WRITER-DELAY | A1 | P1 | `tono/connection/direct.rs:1211` | Stalled reload blocked Restore for 120 seconds | Fixed [#898](https://github.com/raydocs/tono/pull/898) |
| WIN-LOG-UPLOAD-IDENTIFIERS | A9 | P2 | `tono/log_upload.rs:223` | Uploaded logs retained account identifiers | Fixed [#916](https://github.com/raydocs/tono/pull/916) |
| WIN-ACCOUNT-CACHE-OWNERSHIP | A10 | P1 | `tono-ui/TonoAccountCard.tsx:52` | Replacement sign-in retained prior account metadata | Fixed [#932](https://github.com/raydocs/tono/pull/932) |
| WIN-ACTIVITY-PROCESS-PROTOTYPE | A10 | P2 | `pages/tono/activity-model.ts:133` | Process name collided with an inherited object key | Fixed [#951](https://github.com/raydocs/tono/pull/951) |
| WIN-QUIT-ROTATED-TOKEN-DURABILITY | A5/A9 | P1 | `tono/commands/quit.rs:358` | Quit omitted the retry flush for a failed rotated-token write | Fixed [#980](https://github.com/raydocs/tono/pull/980) |
| WIN-SINGLETON-INHERITED-PROXY | A9 | P3 | `utils/server.rs:100` | Inherited proxy intercepted localhost notification | Fixed [#984](https://github.com/raydocs/tono/pull/984) |
| WIN-DIRECT-RESTORE-WRITER-DELAY-AUTO | A1 | P1 | `tono/connection/monitor.rs:1384` | Automatic recovery still waits on a stalled DIRECT reader | Real-unfixed: requires guaranteed AI-blocking fallback before safely accelerating cleanup |

Merge-commit auto-merge was enabled for every PR. **#828 and #898 have `needs-hardware`; the other six have no labels.** Both new regressions passed native Windows CI, in suites with 591 and 592 passing tests.

**107 hypotheses examined:** eight fixed, one real-unfixed, eleven duplicates and **87 false-positive/rejected or unverified leads**.

No assigned production source area remains unfinished. Remaining validation is real-device WFP/DNS fault testing; the automatic-recovery decision item is documented [here](/workspace/w1-codex/out/W1-sol-win-app/direct-auto-health-decision.md).