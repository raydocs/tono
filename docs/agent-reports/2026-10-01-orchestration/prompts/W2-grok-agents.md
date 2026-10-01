## YOUR AREAS (slot W2-grok-agents; branch prefix `hunt/grok-agents-`; can be sent as a reply to bc-0a0f053a)
- **E1**: `services/exit-agent/reconcile_and_report.py` (+ its test). Metering, client install/revocation, crash/restart idempotency. Sol reviewed it; #780 merged fixes.
- **E2**: `services/home-agent/*`, `tooling/scripts/remote/*`, `tooling/scripts/provision-tono-node.py`, `provision-reality-node.rb`.
- **C4 (rest)**: `services/control-plane/src/ops/{traffic-parse,traffic-write,ingest,ingest-hooks,ingest-limits,replay}.ts`. Billing ingest: double counting, replay, counter resets, overflow.
- **T1**: release/sign/publish tooling: `tooling/scripts/{release-macos.sh,notarize-macos.py,publish-macos-appcast.mjs,upload-release-asset.mjs,publish-traffic-policy.mjs,publish-managed-catalog.rb,verify-release-gate.sh,windows-package-components.mjs}` and `.github/workflows/{desktop-update-sign,desktop-update-candidate,macos-release,windows-release,windows-update-promote,release-qualification}.yml`.
  - Supply-chain and update-integrity bugs: unsigned or unverified artifacts, wrong hash pinned, script injection from PR titles/branch names in workflows, secrets exposed to PR workflows.
- **T2**: `tooling/scripts/sing-box/*`, `prepare-macos-sing-box.sh`, `verify-macos-sing-box.sh`, `tooling/scripts/mihomo-adaptive/*`, `tooling/perf/connect-bench`.

Never run publish/deploy scripts for real. Workflow changes must not lower gates.
