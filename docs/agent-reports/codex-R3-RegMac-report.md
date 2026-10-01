Reviewed **49 merged macOS PRs** through `933e7414`. Both fixes passed macOS CI and merged.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| REG-950 | Pins refresh | P1 | AppState+Proxy.swift:519 | Readiness error skipped restoring DIRECT permits | Fixed in **#1039** |
| REG-720 | Recovery | P1 | ConnectionCoordinator.swift:161 | Retry could reconnect after explicit Restore | Fixed in **#1043** |
| REG-794 | Helper upgrade | P1 | HelperManager.swift:259 | Abandoned upgrade loses AI hold | **Real-unfixed:** needs legacy-compatible release contract |
| REG-773, REG-889 | Helper recovery | P1 | SocketServer.swift:328; KillSwitchManager.swift:557 | Automatic releases omitted AI hold | Duplicate; resolved by merged **#1028** |
| REG-802 | Catalog switching | P2 concern | AppState+Catalog.swift:125 | In-flight target removal may queue invalid reload | Unproved; overlaps #963 |
| REG-720-DIAL | Recovery | P2 concern | AppState+Connect.swift:2307 | Alternate proof may precede dialing original exit | Unproved |

- **[#1039](https://github.com/raydocs/tono/pull/1039)** and **[#1043](https://github.com/raydocs/tono/pull/1043)**: merged; `needs-hardware`; merge-commit auto-merge enabled.
- **90 false positives / 100 hypotheses examined.**
- Every matching PR at the cutoff was reviewed. Remaining gaps: the concerns above, pre-existing PF load semantics, and installed-device network acceptance.

[Full per-PR report](/workspace/w1-codex/out/R3-RegMac/report.md) · [All hypotheses and rejection reasons](/workspace/w1-codex/out/R3-RegMac/findings.tsv) · [PR records](/workspace/w1-codex/out/R3-RegMac/prs.tsv)