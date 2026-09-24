# Tono docs

Start here. Dated handoffs and one-off reviews live in [archive/](archive/).

## Development and execution

| Doc | What it owns |
|---|---|
| [INTERNAL_CHANGELOG.md](INTERNAL_CHANGELOG.md) | Internal fixes/features, source and candidate inclusion, verification limits; update in the same delivery PR |
| [FINDINGS_LEDGER.md](FINDINGS_LEDGER.md) | The single ledger of known findings (open / in-PR / fixed / refuted / accepted-design); read before a review or bug fix, update in the same PR |
| [reports/REVIEW_ROUNDS_2026-09-23.md](reports/REVIEW_ROUNDS_2026-09-23.md) | Review → verify → fix → diff-review → merge method, coverage and gaps of the 2026-09-22/23 rounds, reusable review constraints |
| [BUILD_AND_TEST.md](BUILD_AND_TEST.md) | GitHub-hosted CI, MacBook lightweight work, native-device acceptance and cache retention |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Contributor workflow and verification evidence |
| [../AGENTS.md](../AGENTS.md) | Coding-agent rules; choose an execution host before compiling |

Mac Studio no longer serves as a residential exit (owner confirmed 2026-09-14).
Routine builds use GitHub-hosted runners; native-device acceptance remains separate.
Use the execution guide's dated status, not old handoff machine assignments.

## Product

| Doc | What it is |
|---|---|
| [architecture.md](architecture.md) | System map, deployables, macOS / Windows code map |
| [SHIP_PLAN.md](SHIP_PLAN.md) | Customer 0.0.73 — four gates before any update-channel publish |
| [CONNECTION_BETA_2026-09-22.md](CONNECTION_BETA_2026-09-22.md) | G1/G2 native DNS/cancellation optimization and same-route connection measurement, not a speedup claim |
| [UPDATE_PROTOCOL_V1.md](UPDATE_PROTOCOL_V1.md) | Shared macOS/Windows update wire values and conformance, not installation acceptance |
| [UPDATE_INTEGRATION_V1.md](UPDATE_INTEGRATION_V1.md) | Native protected-update ownership, detached transport, paired packaging and G3 evidence boundaries |
| [RELEASE_LINES.md](RELEASE_LINES.md) | `release/macos`, `release/windows`, `main`; tag formats |
| [ui-design-system.md](ui-design-system.md) | Shared visual tokens for both clients |
| [desktop-clarity.md](desktop-clarity.md) | Welcome / login / content-layer clarity |
| [welcome-v2.md](welcome-v2.md) | Welcome flow copy and layout |
| [STABILITY_0_0_72.md](STABILITY_0_0_72.md) | Frozen 0.0.72 baseline |
| [WINDOWS_0_0_72_DEVICE_ACCEPTANCE.md](WINDOWS_0_0_72_DEVICE_ACCEPTANCE.md) | Windows device acceptance log |
| [ARCHITECTURE_UPGRADE_PROGRESS.md](ARCHITECTURE_UPGRADE_PROGRESS.md) | In-tree extraction DAG (not a ship gate) |

## Ops

Living operator docs. The current ops backlog is
[ops/plan-2026-09-11.md](ops/plan-2026-09-11.md).

| Doc | What it is |
|---|---|
| [ops/plan-2026-09-11.md](ops/plan-2026-09-11.md) | Ops work that is **not** a customer-ship gate |
| [ops/org-plan-2026-09-10.md](ops/org-plan-2026-09-10.md) | Department ownership for the ops console |
| [ops/api-contract.md](ops/api-contract.md) | Ops HTTP contract |
| [ops/fixtures.md](ops/fixtures.md) | Console fixtures |
| [ops/d1-backups.md](ops/d1-backups.md) | D1 backup |
| [ops/restore-production.md](ops/restore-production.md) | Production restore |
| [ops/ingest-limits.md](ops/ingest-limits.md) | Ingest budgets |
| [ops/parity-audit.md](ops/parity-audit.md) | Client/ops parity |
| [ops/rollout-ops2.md](ops/rollout-ops2.md) | `/ops2/` rollout runbook |
| [ops/transport-hy2.md](ops/transport-hy2.md) | hy2 transport |
| [ops/billing-model-proposal.md](ops/billing-model-proposal.md) | Billing proposal (undecided) |

## Screenshots

[screenshots/](screenshots/) — dashboard, proxies, settings, icon.

## Archive

[archive/](archive/) — dated ops reviews, a few retained technical write-ups and the
Clash Verge leftover inventory. Do not treat these as current instructions.
