**Operator action required:** #969’s test correction is local at `4c31162d` on `hunt/sol-misc-command-identity`. Title: `fix(ops): give private command rows distinct identities`. Both push attempts failed. Apply the [saved patch](/workspace/w1-codex/out/W2-sol-leftovers/command-identity-guard.patch) onto the updated remote branch; [prepared body](/workspace/w1-codex/out/W2-sol-leftovers/command-identity-pr.md).

#915 merged, but its body update failed twice through the deprecated Projects API. Branch: `hunt/sol-misc-ops-contract-findings`; title: `docs(findings): record remaining ops data contract defects`; [updated body](/workspace/w1-codex/out/W2-sol-leftovers/ops-contract-findings-pr.md).

**80 hypotheses examined:** 13 verified fixes, seven real-unfixed items, three duplicates, and 57 rejected/unproved hypotheses. No verified P0/P1. The [full 80-row report](/workspace/w1-codex/out/W2-sol-leftovers/report.md) includes every false-positive reason.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| M14-MATCH-FLAG-CRASH | M14 | P3 | Models/RuleEntry.swift:102 | Malformed import indexes beyond remaining fields | Fixed, merged #818 |
| WIN-WS-ID-IPC-U128 | A13 | P2 | tono-plugin-core/src/commands.rs:258 | Numeric handle prevents native WebSocket cleanup | Fixed, merged #834 |
| T4-REACHABILITY-SIGPIPE | T4 | P3 | test-suite-reachability.sh:68 | Early grep exit falsely reports missing registration | Fixed, merged #823 |
| T4-INSTALL-MISSING-ARG | T4 | P3 | test-helper-install-lifecycle.sh:47 | Missing option value loops forever | Fixed, merged #892 |
| O1-QUOTA-ROUNDTRIP | O1 | P2 | lib/node-detail.ts:303 | Saving rounds fractional quotas | Fixed in #825 |
| O1-FX-PREVIEW-DATE | O1 | P2 | settings/LedgerDrawer.tsx:98 | Preview uses a different exchange-rate date from posting | Fixed, merged #848 |
| O1-DESTINATION-NODE | O1 | P2 | customer/Destinations.tsx:30 | Totals combine exits but retain only the first attribution | Fixed, merged #869 |
| O1-PAGE-FRESHNESS | O1 | P2 | lib/use-resource.ts:73 | Fresh health response hides stale page data | Fixed, merged #880 |
| O1-SLO-DAY-UTC | O1 | P2 | settings/LedgerSlo.tsx:41 | UTC bucket displays the preceding local date | Fixed in #957 |
| O1-PUBLISH-METADATA | O1 | P2 | settings/use-document.ts:135 | Publication retains old timestamp/signature state | Fixed in #965 |
| O1-CATALOG-HISTORY | O1 | P2 | settings/Catalog.tsx:176 | Open history keeps the previous revision current | Fixed in #965 |
| O1-DEVICE-READ-ERROR | O1 | P2 | customer/Devices.tsx:69 | Failed read appears empty and enables an unknown log toggle | Fixed in #968 |
| O1-COMMAND-IDENTITY-COLLISION | O1 | P2 | app/CommandPalette.tsx:95 | Equal masked labels can open the wrong person | Fixed in #969; test correction needs operator push |
| O1-ADOPTION-DRILLDOWN | O1 | P2 | lib/customers.ts:223 | Matrix and linked list use different cohorts | Unfixed: shared server cohort contract needed |
| O1-ADOPTION-TOTAL | O1 | P2 | pages/Clients.tsx:159 | Overlapping cells double-count people | Unfixed: distinct-user aggregate or wording decision |
| O1-ANCHOR-CLAMPED | O1 | P2 | node/ProfileDrawer.tsx:80 | February save changes configured day31 to28 | Unfixed: configured anchor missing from DTO |
| O1-ACTIVITY-HOUR-COLLISION | O1 | P2 | ops/HeatStrip.tsx:34 | Device/DST rows overwrite activity | Unfixed: interval and repeated-hour semantics needed |
| T4-REGISTRATION-GLOB | T4 | P3 | test-suite-reachability.sh:68 | Wildcard references and missing callers remain unresolved | Unfixed: scanner/registration gaps |
| T4-AGGREGATE-INSTALL-INPUT | T4 | P3 | test-macos-all.sh:79 | Aggregate omits required emitted install script | Unfixed: harness input contract; native path unavailable |
| T4-AGGREGATE-HIDDEN-SKIP | T4 | P3 | test-macos-all.sh:27 | Aggregate hides intentional skips and counts them passed | Unfixed: skip-status contract |
| M14-empty-region-name | M14 | P3 | Views/NodeCardView.swift:31 | Empty name indexing | Duplicate #804 |
| WIN-WS-ONCONNECTED-WATCHDOG | A13 | P3 | use-mihomo-ws-subscription.ts:145 | Late initialization loses cleanup | Duplicate #768 |
| O1-ANCHOR-UTC | O1 | P2 | lib/node-detail.ts:325 | Local conversion shifts UTC billing anchor | Duplicate #805 |

PR status at handoff:

| PRs | Status | Labels / auto-merge |
|---|---|---|
| #818, #823, #834, #892 | Merged; gates passed | No labels; auto-merge enabled |
| #848, #869, #880 | Externally merged; gates passed | `ui-review`; hunter left auto off |
| #915 | Merged; gate passed | No labels; auto externally disabled |
| #825 | Open; gate passed | `ui-review`; auto off |
| #957, #965, #968 | Open; refreshed integration CI pending | `ui-review`; auto off |
| #969 | Open; test check blocked pending saved correction | `ui-review`; auto off |

Regressions preceded source fixes. Hosted Windows CI proved #834’s generated IPC handler test; relevant local checks passed, including ten publication flows and eight search flows. The separate control-plane baseline failure was repaired in main by #931 without weakening its gate.

The assigned source pass finished. Native real-device validation and the slow-filesystem export hypothesis remain unverified. No network-policy changes, deployment or publication occurred.