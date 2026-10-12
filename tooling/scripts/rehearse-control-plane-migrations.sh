#!/bin/sh
# Local rehearsal of pending control-plane D1 migrations, before the preview
# rehearsal of ops plan §2 rule 1 and long before deploy-control-plane-main.sh.
#
# Everything here is local: wrangler runs only with --local and a throwaway
# --persist-to directory. Nothing is sent to Cloudflare. The script never
# assembles a --remote argv and refuses arguments that name production. The
# preview step is printed for the owner to run with their `tono` wrangler
# profile; this script does not run it.
#
# Steps:
#   1. Static check: every migration above the production high-water mark is
#      additive (no DROP, no RENAME, no ADD COLUMN NOT NULL without DEFAULT).
#   2. Fresh state: `wrangler d1 migrations apply DB --local` on an empty
#      database with the real wrangler.jsonc.
#   3. Seeded state: a separate local database migrated only to the
#      high-water mark, loaded with the synthetic preview seed
#      (services/control-plane/preview/seed.mjs; no production data), then
#      migrated to the end. Every table and column that existed before must
#      still exist, with the same row count.
#   4. Fresh and seeded end states must have the same tables and columns.
#   5. Print the preview command.
#
# Usage:
#   tooling/scripts/rehearse-control-plane-migrations.sh [--high-water NNNN] [--keep DIR]
#
#   --high-water  last migration applied in production (default below; the
#                 deploy changelog entry records each new one).
#   --keep DIR    keep the local state and snapshots in DIR instead of a
#                 temporary directory.
set -eu

# Last migration applied to production D1 `tono-control-plane`: 0094 and 0095
# went live with docs/changelog.d/2026-10-10-control-plane-deploy-11441941.md.
# Bump this after each production deploy that applies migrations.
PRODUCTION_HIGH_WATER=0095
PRODUCTION_D1_NAME=tono-control-plane
PREVIEW_D1_NAME=tono-control-plane-ops-preview
# A local-only id for the seeded database's throwaway config. Never a real one.
REHEARSAL_D1_ID=00000000-0000-4000-8000-000000000000

fail() {
  printf 'rehearse-control-plane-migrations: %s\n' "$1" >&2
  exit 1
}

say() {
  printf 'rehearse-control-plane-migrations: %s\n' "$1"
}

usage() {
  printf '%s\n' "usage: $0 [--high-water NNNN] [--keep DIR]" >&2
}

# Refuse anything that could point a wrangler call at a remote database.
# Checked on the script's own arguments and again on every wrangler argv.
refuse_production_argv() {
  for arg in "$@"; do
    case $arg in
      --remote|--remote=*|--env|--env=*|--preview|"$PRODUCTION_D1_NAME"|"$PREVIEW_D1_NAME")
        fail "refusing to target a remote database ($arg); this rehearsal is local only"
        ;;
    esac
  done
}

refuse_production_argv "$@"

high_water=$PRODUCTION_HIGH_WATER
keep_dir=
while [ $# -gt 0 ]; do
  case $1 in
    --high-water)
      [ $# -ge 2 ] || fail "--high-water requires a value"
      high_water=$2
      shift 2
      ;;
    --keep)
      [ $# -ge 2 ] || fail "--keep requires a directory"
      keep_dir=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      fail "unknown argument: $1"
      ;;
  esac
done
case $high_water in
  [0-9][0-9][0-9][0-9]) ;;
  *) fail "--high-water must be a four-digit migration number (got $high_water)" ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
control_plane=$repo_root/services/control-plane
migrations=$control_plane/migrations
checker=$script_dir/check-migrations-additive.mjs
[ -f "$control_plane/wrangler.jsonc" ] || fail "missing $control_plane/wrangler.jsonc"
[ -d "$control_plane/node_modules/wrangler" ] \
  || fail "run npm ci in services/control-plane first (wrangler is not installed)"

if [ -n "$keep_dir" ]; then
  mkdir -p "$keep_dir" || fail "could not create $keep_dir"
  work=$(CDPATH= cd -- "$keep_dir" && pwd)
else
  work=$(mktemp -d "${TMPDIR:-/tmp}/tono-migration-rehearsal.XXXXXX") \
    || fail "could not create a temporary directory"
  trap 'rm -rf "$work"' 0 INT HUP TERM
fi
[ -z "$(ls -A "$work" 2>/dev/null)" ] || fail "$work is not empty; a rehearsal starts from nothing"

run_wrangler() {
  refuse_production_argv "$@"
  # Local only, belt and braces: an argv without --local is never run.
  case " $* " in
    *" --local "*) ;;
    *) fail "internal: wrangler call without --local refused" ;;
  esac
  (cd "$control_plane" && /usr/bin/env npx wrangler "$@") >"$work/wrangler.log" 2>&1 \
    || { tail -n 40 "$work/wrangler.log" >&2; return 1; }
}

# 1. Static additive check on the pending files.
node "$checker" check --dir "$migrations" --high-water "$high_water" \
  || fail "pending migrations are not additive (ops plan §2 rule 1); see above"

# 2. Fresh state, the real config.
mkdir -p "$work/fresh"
run_wrangler d1 migrations apply DB --local --persist-to "$work/fresh" \
  || fail "fresh-state migrations apply failed"
node "$checker" snapshot --persist "$work/fresh" --out "$work/fresh.json" \
  || fail "could not read the fresh local database"
say "fresh state: all migrations applied"

# 3. Seeded state: up to the high-water mark, seed, then the rest.
mkdir -p "$work/seeded" "$work/seeded-migrations"
applied=$(node "$checker" pending --dir "$migrations" --high-water "$high_water")
[ -n "$applied" ] || fail "no migrations at or below $high_water"
for name in $applied; do
  cp "$migrations/$name" "$work/seeded-migrations/$name"
done

write_config() {
  cat >"$work/wrangler.rehearsal.jsonc" <<EOF
{
  "name": "tono-migration-rehearsal",
  "compatibility_date": "2026-01-01",
  "d1_databases": [{
    "binding": "DB",
    "database_name": "tono-migration-rehearsal",
    "database_id": "$REHEARSAL_D1_ID",
    "migrations_dir": "$1"
  }]
}
EOF
}

write_config "$work/seeded-migrations"
run_wrangler d1 migrations apply DB --local --config "$work/wrangler.rehearsal.jsonc" \
  --persist-to "$work/seeded" \
  || fail "migrations up to $high_water failed on the seeded database"
(cd "$control_plane" && node preview/write-seed.mjs --output "$work/seed.sql") >/dev/null \
  || fail "could not render the synthetic preview seed"
run_wrangler d1 execute DB --local --config "$work/wrangler.rehearsal.jsonc" \
  --persist-to "$work/seeded" --file "$work/seed.sql" -y \
  || fail "the synthetic seed did not load at $high_water"
node "$checker" snapshot --persist "$work/seeded" --out "$work/seeded-before.json" \
  || fail "could not read the seeded local database"

write_config "$migrations"
run_wrangler d1 migrations apply DB --local --config "$work/wrangler.rehearsal.jsonc" \
  --persist-to "$work/seeded" \
  || fail "pending migrations failed on the seeded database"
node "$checker" snapshot --persist "$work/seeded" --out "$work/seeded-after.json" \
  || fail "could not read the migrated seeded database"
node "$checker" compare --before "$work/seeded-before.json" --after "$work/seeded-after.json" \
  || fail "pending migrations lost a table, a column or rows on the seeded database"
say "seeded state: pending migrations kept every table, column and row from $high_water"

# 4. Same end schema either way.
node "$checker" compare --before "$work/fresh.json" --after "$work/seeded-after.json" --same-schema \
  || fail "fresh and seeded end states differ"
say "fresh and seeded end states have the same tables and columns"

# 5. The preview step, for the owner (ops plan §2 rule 1). Not run here.
preview_config=services/control-plane/wrangler.preview.generated.jsonc
if [ ! -f "$repo_root/$preview_config" ]; then
  preview_config=services/control-plane/wrangler.preview.jsonc
fi
if [ -f "$repo_root/$preview_config" ]; then
  # wrangler takes database_id from --config; a preview config that kept the
  # production id would migrate the live database. Refuse to print it.
  prod_ids=$(grep -ho '"database_id"[[:space:]]*:[[:space:]]*"[^"]*"' \
      "$control_plane/wrangler.jsonc" "$control_plane/wrangler.admin.jsonc" 2>/dev/null \
    | sed 's/.*"\([^"]*\)"$/\1/' | tr 'A-F' 'a-f')
  preview_ids=$(grep -ho '"database_id"[[:space:]]*:[[:space:]]*"[^"]*"' "$repo_root/$preview_config" \
    | sed 's/.*"\([^"]*\)"$/\1/' | tr 'A-F' 'a-f')
  for id in $preview_ids; do
    for prod in $prod_ids; do
      [ "$id" != "$prod" ] \
        || fail "$preview_config database_id is the production id; fix it before any preview rehearsal"
    done
  done
fi

cat <<EOF

Local rehearsal passed for migrations above $high_water.
Next, the preview rehearsal (ops plan §2 rule 1). Run it yourself from the
repository root of the maintainer checkout, with the wrangler profile bound to
the tono account; this script does not run it:

  npx --prefix services/control-plane wrangler d1 migrations apply $PREVIEW_D1_NAME --remote --config $preview_config

For a production-shaped rehearsal, first load the latest D1 backup into the
preview database with tooling/scripts/restore-control-plane-d1-preview.sh
(it also applies pending migrations). Production migrations run only through
tooling/scripts/deploy-control-plane-main.sh, after a D1 export.
EOF
