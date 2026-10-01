New assignment from the orchestrator (you were launched by us). Your previous round is done: #766/#767 merged; #768 #770 #771 #772 are open with auto-merge.

1. STOP the branch churn. The merge queue on `main` is live. Do not merge main into your branches, do not rebase them just because they are BEHIND, do not push empty commits, and do not toggle auto-merge. Another executor handles BEHIND/queue issues. Rebase only on a real conflict (mergeable_state dirty), and only your own branch.

2. NEW HUNT AREAS (disjoint from the other agents; the full rules are the same as your first round). Always start from the latest origin/main and check open PRs first.
   - **E1**: `services/exit-agent/reconcile_and_report.py` (+ test). Metering, client install/revocation, crash/restart idempotency. #780 already merged several fixes; read it first.
   - **E2**: `services/home-agent/*`, `tooling/scripts/remote/*`, `tooling/scripts/provision-tono-node.py`, `provision-reality-node.rb`.
   - **C4 (rest)**: `services/control-plane/src/ops/{traffic-parse,traffic-write,ingest,ingest-hooks,ingest-limits,replay}.ts`. Billing ingest: double counting, replay, counter resets, overflow.
   - **T1**: release/sign/publish tooling (`tooling/scripts/{release-macos.sh,notarize-macos.py,publish-macos-appcast.mjs,upload-release-asset.mjs,publish-traffic-policy.mjs,publish-managed-catalog.rb,verify-release-gate.sh,windows-package-components.mjs}` and the `desktop-update-*`, `*-release.yml`, `windows-update-promote.yml`, `release-qualification.yml` workflows). Look for update-integrity and supply-chain bugs: unverified artifacts, wrong pinned hash, injection from PR titles/branch names, secrets reachable from PR workflows. Never run publish/deploy for real.
   - **T2**: `tooling/scripts/sing-box/*`, `prepare-macos-sing-box.sh`, `verify-macos-sing-box.sh`, `tooling/scripts/mihomo-adaptive/*`, `tooling/perf/connect-bench`.

3. PR rules (updated):
   - Non-draft, merge commit, auto-merge ON for everything except UI.
   - Network-behavior PRs get the `needs-hardware` label (via `gh api -X POST repos/raydocs/tono/issues/N/labels -f 'labels[]=needs-hardware'`) AND still get auto-merge.
   - UI PRs get `ui-review` and NO auto-merge.
   - Do not edit `docs/DECISIONS.md` (it is being split into `docs/decisions/`).
   - Add `docs/changelog.d` + `docs/findings.d` entries. Add `Fixes #N` when an issue matches.

Top rule: never cut the user's network. Fail open on crash/hang/failed update while still blocking AI services. Never weaken AI blocking.

Final report: a table of findings (ID | area | severity | file:line | description | verdict: fixed in #PR / unfixed + reason / false positive + reason), your PRs, and your false-positive count.
