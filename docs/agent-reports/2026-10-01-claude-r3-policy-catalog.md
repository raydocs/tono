# Claude round 3: signed traffic policy and exit catalog (2026-10-01)

Scope: the signed traffic policy and exit catalog end to end. That covers control-plane generation and admission (`traffic-policy.ts`, `ops/shared-admin/traffic-policy.ts`, `catalog.ts`, `catalog-yaml.ts`, `ops/shared-admin/catalog.ts`); Windows verification and compilation (`tono-core` `policy.rs`, `policy_signature.rs`, `direct_domains.rs`, `sing_box/runtime.rs`, `sing_box/clash_rules.rs`, mihomo rules in `config.rs`, app `core_select.rs`, Service `direct_admission.rs`/`sing_box_runtime.rs`); and macOS (`ManagedTrafficPolicyProcessor.swift`, `ConfigPipeline+Direct.swift`, `ConfigPipeline+Runtime.swift` rules, `ConfigPipeline+SingBoxProduct.swift`). Baseline `origin/main` `10ce26c9`. The known items #1204/#1248, #1260/#1267 and #317 were excluded, as was everything already in the findings ledger.

## Findings

| ID | Severity | Location | Verdict | Action |
|---|---|---|---|---|
| C3-PC-F1 | P1 (high, derived) | `apps/windows/crates/tono-core/src/sing_box/runtime.rs:304-326` | Confirmed. With a home hop on the sing-box path (now the Windows default), assistant pins are TCP only. With an HY2 exit selected, assistant UDP/QUIC leaves via `final` on the cloud exit. #783 fixed only mihomo and recorded the sing-box gap as "not on product path", which is no longer true. | Fixed in #1272 (one regression). Labelled `needs-hardware`. Auto-merge **not** enabled because this is routing; it needs an independent Codex review. |
| C3-PC-F2 | P3 (low, derived) | `services/control-plane/src/ops/shared-admin/catalog.ts:121` | Confirmed. Full-replace PUT skips `catalogEntryMissingClientFields`/hy2 completeness, which only relist runs, so one inadmissible block makes both clients refuse the whole catalog. | Issue #1273 (fixture churn of about 30 tests; not fixed this round). |

## Checked and not a defect

- Protected and assistant guard lists: the control plane (`protectedSuffixes` + `assistantHomeSuffixes`), Windows (`PROTECTED_DIRECT_SUFFIXES` + `CLAUDE_HOME_DOMAINS`) and macOS (`managedDirectProtectedSuffixes` + `assistantHomeDomainSuffixes`) were compared mechanically. The sets are identical, 84 entries in all.
- Signature path: Windows `verdict_with_key` and macOS `ManagedTrafficPolicySignature` both refuse a bad signature outright (no partial trust). Cache load and store re-verify, and the server PUT verifies the exact canonical bytes, including the embedded revision. `trusted` relaxes only allowlists. Protected and assistant hosts are still refused for `domains`, `webDomains` and `directSuffixes` on all three. `directSuffixes` also refuses ancestors of guarded hosts, except `aliyuncs.com` over the dedicated model-API children, which every emitter pins first.
- Same-revision downgrade (signed→unsigned) and replacement: refused on Windows (`same_revision_transition`) and on macOS (`persistIfNewest`).
- AI-to-DIRECT ordering: Windows sing-box, Windows mihomo, macOS mihomo and macOS sing-box all emit assistant TCP pins before every DIRECT row (process, exact pin, web suffix). Service admission also requires those pins before a process or suffix DIRECT rule.
- Cross-account catalog: `filterCatalogYamlForUser` withholds restricted home names and their ` · hy2` twins unless that exact exit is bound. Identity substitution is per user and device after filtering.
- hy2 as a second identity: hy2 blocks must carry ` · hy2`, a placeholder password, a DER fingerprint and no `skip-cert-verify`. VLESS blocks cannot carry the hy2 suffix or SPKI key. Base/twin server equality is still Worker-only (ledger D6, accepted design).

## Open risks

- #1272 is unverified on hardware: the QUIC→TCP fallback for assistants with HY2 and home routing on Windows.
- The Jev-Decision trailer on the #1272 commits uses `r3-policy-catalog`, because the dispatch named no decision id.
