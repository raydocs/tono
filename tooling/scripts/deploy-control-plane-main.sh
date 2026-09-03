#!/bin/zsh
set -euo pipefail

# Production has one owner: the exact remote main commit. Deploying the Worker
# from a feature or platform branch previously removed bindings and endpoints
# installed by another branch while leaving its D1 migrations behind.

script_path=${0:A}
repo_root=${script_path:h:h:h}
control_plane="$repo_root/services/control-plane"
migration_fence_active=0

fail() {
  print -r -- "deploy-control-plane: $1" >&2
  if (( migration_fence_active )); then
    print -r -- "deploy-control-plane: rollup migration is applied but the v2 API Worker is not confirmed deployed; the database fence will reject old retention runs without deleting their source rows" >&2
  fi
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

# The release centre is served from public/ by this very deploy, so a stale page
# would go live here and nowhere else would catch it.
/usr/bin/git -C "$repo_root" fetch --quiet origin windows-updates \
  || fail "could not refresh origin/windows-updates, which the download page reads"
/usr/bin/env node "$repo_root/tooling/scripts/generate-release-center.mjs" \
  --repo-root "$repo_root" --check \
  || fail "the download page does not match what the feed and the channel serve"

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

# Schema first is safe because migration 0028 installs a database fence: the
# pre-0028 Worker cannot enter either rollup UPSERT branch and therefore cannot
# reach its separate source-row DELETE. A failed code deploy leaves retention
# paused-by-rejection rather than silently corrupting hourly history.
/usr/bin/env npx wrangler d1 migrations list tono-control-plane --remote \
  --config wrangler.jsonc
/usr/bin/env npx wrangler d1 migrations apply tono-control-plane --remote \
  --config wrangler.jsonc \
  || fail "D1 migrations failed; no Worker was deployed"
migration_fence_active=1

schema=$(/usr/bin/env npx wrangler d1 execute tono-control-plane --remote --json \
  --config wrangler.jsonc \
  --command "SELECT name FROM pragma_table_info('operations_agent_rollups') WHERE name IN ('rollup_writer_version','sample_counts_exact'); SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'operations_agent_rollups_require_writer_v2';") \
  || fail "could not verify the post-migration rollup schema"
[[ $schema == *rollup_writer_version* && $schema == *sample_counts_exact* && $schema == *operations_agent_rollups_require_writer_v2* ]] \
  || fail "rollup writer fence or marker columns are missing after migrations"

/usr/bin/env npx wrangler deploy --strict \
  --var "BUILD_SHA:$source_commit" \
  --tag "main-$short_commit" \
  --message "source main@$source_commit" \
  || fail "API Worker deploy failed"
migration_fence_active=0

# The version endpoint only declares alignment when both Workers report this
# same full SHA. Deploying only the API left the Access-hosted console able to
# serve an older UI against a newer contract while claiming "development" was
# aligned with itself.
/usr/bin/env npx wrangler deploy --strict \
  --config wrangler.admin.jsonc \
  --var "BUILD_SHA:$source_commit" \
  --tag "main-$short_commit" \
  --message "source main@$source_commit" \
  || fail "admin Worker deploy failed after the API Worker was updated"

print -r -- "deployed control plane and admin Worker from main@$source_commit"
