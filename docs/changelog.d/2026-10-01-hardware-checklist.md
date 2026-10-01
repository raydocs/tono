## 2026-10-01 · Real-hardware test checklist, Windows sing-box default added
- Ownership: SHIP_PLAN G1 test evidence; docs only, no product change. All Windows and macOS items are `needs-hardware`.
- Source: PR #1053, rebased onto `main` `0676435b`; `docs/agent-reports/2026-10-01-hardware-checklist.md` and its README entry.
- Defect fix: none.
- New/optimization: section 6 adds the device steps for the Windows sing-box default kernel (#1140, #1159, #1175, #1188, #1196), the mihomo-only items (#1119 gVisor window, #1121 lazy DoH backup, #1122 and #1126 deferred `/delay`), the 58 later merged `needs-hardware` fail-open and recovery PRs (#1061 to #1203), and control-plane fences (#1080, #1167, #1170, #1203). Section 7 (signed-candidate update paths), appendix A and appendix B are refreshed. Step zero stays a backup.
- Engineering/tests: none; nothing was run on a device.
- Verification: every `needs-hardware` PR number is now referenced in the file (`gh pr list --label needs-hardware --state all` against the file). Items were derived from the PR bodies; none was executed.
- Candidate/publication: none; the sing-box items need a package that carries `sing-box.exe`, which is not built yet.
- Limits: expected results quote the PR bodies. Whether the macOS App-side selective AI hook is now registered is not verified; M18 and the known-gap note ask the tester to record it. #1197 (kernel swap in Protected Offline) and #1204 (DIRECT outbound rule bound) remain open and are named in W23 and W28.
