#!/usr/bin/env bash
# push regenerated reports to a docs PR (no auto-merge). Reuses the open docs PR branch if still open.
set -euo pipefail
B=/workspace/w1-codex; D=$B/docs-wt
python3 $B/report.py > /dev/null
cd $D
git fetch -q origin main
OPEN=$(gh pr list -R raydocs/tono --state open --author @me --search "head:docs/codex-hunt-status" --json number,headRefName --jq '.[0].headRefName // ""')
if [ -n "$OPEN" ]; then BR=$OPEN; git checkout -q -B $BR origin/$BR 2>/dev/null || { git fetch -q origin $BR && git checkout -q -B $BR FETCH_HEAD; }; git merge -q --no-edit origin/main || true
else BR=docs/codex-hunt-status-$(date +%H%M); git checkout -q -B $BR origin/main; fi
mkdir -p docs/agent-reports; cp $B/report-out/*.md docs/agent-reports/
git add docs/agent-reports
git diff --cached --quiet && { echo "no changes"; exit 0; }
git commit -qm "docs(agent-reports): refresh Codex hunt status and per-slot findings ($(date '+%H:%M MT'))"
git push -q origin HEAD:refs/heads/$BR
if [ -z "$OPEN" ]; then
  printf '%s\n' "## Summary" "- Refreshes \`docs/agent-reports/W1_CODEX_STATUS.md\` and adds/updates \`docs/agent-reports/codex-<slot>-findings.md\` for the Codex (GPT-6.1 Sol, account 2) hunt slots: every hypothesis with its verdict, and the PRs opened." "- Docs only. Auto-merge intentionally not enabled (the merge manager batches report PRs)." > /tmp/docs-body2.md
  gh pr create -R raydocs/tono --base main --head $BR --title "docs(agent-reports): Codex hunt status and per-slot findings" --body-file /tmp/docs-body2.md
else echo "updated $BR"; fi
