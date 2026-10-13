#!/bin/sh
# Nightly retro: one agent reviews yesterday's merged PRs, main commits and CI
# runs for rework, merges that should not have happened and weak verification,
# and records them in docs/LESSONS.md (prompt: docs/ops/nightly-retro.md).
#
# It runs in a throwaway worktree of origin/main so it never touches the
# maintainer's checkout or another agent's branch, and removes it afterwards.
#
# Usage:
#   tooling/scripts/nightly-retro.sh [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--dry-run]
#
# Default window: yesterday (both dates inclusive). --dry-run prints the prompt and stops.
# Logs: ~/Library/Logs/tono-nightly-retro/<date>.log when run from launchd.
set -eu

repo=$(cd "$(dirname "$0")/../.." && git rev-parse --show-toplevel)
since=$(date -v-1d +%Y-%m-%d)
until=$since
dry_run=0
while [ $# -gt 0 ]; do
  case "$1" in
    --since) since=$2; shift 2 ;;
    --until) until=$2; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

prompt="$(cat "$repo/docs/ops/nightly-retro.md")

Window: SINCE=$since UNTIL=$until (inclusive). Today is $(date +%Y-%m-%d)."

if [ "$dry_run" = 1 ]; then
  printf '%s\n' "$prompt"
  exit 0
fi

git -C "$repo" fetch -q origin main
wt=$(mktemp -d "${TMPDIR:-/tmp}/tono-retro.XXXXXX")
trap 'git -C "$repo" worktree remove --force "$wt" 2>/dev/null || true' EXIT
git -C "$repo" worktree add -q --detach "$wt" origin/main

cd "$wt"
claude -p "$prompt" \
  --model "${TONO_RETRO_MODEL:-claude-opus-5-5}" \
  --effort high \
  --dangerously-skip-permissions
