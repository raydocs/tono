#!/bin/zsh
set -euo pipefail

# Production has one owner: the exact remote main commit. Deploying the Worker
# from a feature or platform branch previously removed bindings and endpoints
# installed by another branch while leaving its D1 migrations behind.

script_path=${0:A}
repo_root=${script_path:h:h:h}
control_plane="$repo_root/services/control-plane"

fail() {
  print -r -- "deploy-control-plane: $1" >&2
  exit 1
}

branch=$(/usr/bin/git -C "$repo_root" symbolic-ref --quiet --short HEAD 2>/dev/null) \
  || fail "deployment requires a branch checkout, not a detached HEAD"
[[ $branch == main ]] || fail "production deploys are restricted to main; current branch is $branch"
[[ -z $(git -C "$repo_root" status --porcelain) ]] \
  || fail "the worktree is dirty; commit and push the exact deployment source first"

/usr/bin/git -C "$repo_root" fetch --quiet origin main \
  || fail "could not refresh origin/main"
source_commit=$(/usr/bin/git -C "$repo_root" rev-parse HEAD)
remote_commit=$(/usr/bin/git -C "$repo_root" rev-parse origin/main)
[[ $source_commit == $remote_commit ]] \
  || fail "local main is $source_commit but origin/main is $remote_commit"

cd "$control_plane"
/usr/bin/env npm ci
/usr/bin/env npm run typecheck
/usr/bin/env npm test
"$repo_root/tooling/scripts/test-policy-signing-contract.sh"
/usr/bin/env npm run admin:build

# The console is built here rather than shipped from the repository. There used
# to be a second worktree-clean check after this build, on the premise that the
# built assets are committed deployment inputs — but `public/ops/` is listed in
# services/control-plane/.gitignore and has never had a tracked file in it, so
# the build wrote into an ignored directory and the check could not fail. It
# guarded nothing while reading like the thing that made the build reproducible.
#
# What actually ties a deployed bundle to a revision is the tag below: the
# Worker version records main@<sha>, and rebuilding from that commit reproduces
# what shipped. The check worth having is the one above — that the source is
# exactly remote main — and that one is real.

short_commit=${source_commit[1,12]}
/usr/bin/env npx wrangler deploy --strict \
  --tag "main-$short_commit" \
  --message "source main@$source_commit"

print -r -- "deployed control plane from main@$source_commit"
