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

# Static ops assets are committed deployment inputs. A non-deterministic or
# forgotten build must be reviewed and pushed instead of being smuggled into a
# Worker version whose metadata claims it came from an otherwise clean SHA.
[[ -z $(git -C "$repo_root" status --porcelain) ]] \
  || fail "admin build changed tracked output; commit and push it before deploying"

short_commit=${source_commit[1,12]}
/usr/bin/env npx wrangler deploy --strict \
  --tag "main-$short_commit" \
  --message "source main@$source_commit"

print -r -- "deployed control plane from main@$source_commit"
