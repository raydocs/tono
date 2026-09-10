#!/bin/sh
# Restore a D1 backup object into the isolated operations-preview database.
#
# This script will not run against production. The execute target is the
# preview database named in services/control-plane/preview/README.md
# (`tono-control-plane-ops-preview`), hard-coded below. The production name
# `tono-control-plane` is also hard-coded as a refuse list so a rename that
# accidentally makes the two strings equal still stops here, rather than
# importing a dump over live accounts.
#
# Usage:
#   tooling/scripts/restore-control-plane-d1-preview.sh [--keep-local DIR] <object>
#
#   object is an R2 key under tono-releases, a basename, or bucket/key:
#     backups/control-plane-d1/2026-09-09T03:17:05Z.sql.gz
set -eu

PRODUCTION_D1_NAME=tono-control-plane
PREVIEW_D1_NAME=tono-control-plane-ops-preview
RELEASES_BUCKET=tono-releases
BACKUP_PREFIX=backups/control-plane-d1

fail() {
  printf 'restore-control-plane-d1-preview: %s\n' "$1" >&2
  exit 1
}

usage() {
  printf '%s\n' "usage: $0 [--keep-local DIR] <object-key>" >&2
}

keep_local_dir=
object_arg=

while [ $# -gt 0 ]; do
  case $1 in
    --keep-local)
      [ $# -ge 2 ] || fail "--keep-local requires a directory"
      keep_local_dir=$2
      shift 2
      ;;
    --keep-local=*)
      keep_local_dir=${1#--keep-local=}
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      usage
      fail "unknown argument: $1"
      ;;
    *)
      [ -z "$object_arg" ] || fail "unexpected extra argument: $1"
      object_arg=$1
      shift
      ;;
  esac
done

[ -n "$object_arg" ] || { usage; fail "missing object key"; }

# Hard-coded guard: never assemble an execute argv that names production,
# including the wrangler.jsonc binding `DB` which is tono-control-plane.
if [ "$PREVIEW_D1_NAME" = "$PRODUCTION_D1_NAME" ]; then
  fail "preview database name equals production ($PRODUCTION_D1_NAME); refusing to run"
fi
if [ "$PREVIEW_D1_NAME" = "DB" ]; then
  fail "preview database name is the production binding DB; refusing to run"
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
control_plane=$repo_root/services/control-plane
[ -f "$control_plane/wrangler.jsonc" ] \
  || fail "missing $control_plane/wrangler.jsonc"

if [ -n "$keep_local_dir" ]; then
  mkdir -p "$keep_local_dir" || fail "could not create $keep_local_dir"
  keep_local_dir=$(CDPATH= cd -- "$keep_local_dir" && pwd)
fi

work_dir=
cleanup() {
  if [ -n "${work_dir:-}" ] && [ "$work_dir" != "$keep_local_dir" ]; then
    rm -rf "$work_dir"
  fi
}
trap cleanup 0 INT HUP TERM

if [ -n "$keep_local_dir" ]; then
  work_dir=$keep_local_dir
else
  work_dir=$(mktemp -d "${TMPDIR:-/tmp}/tono-cp-d1-restore.XXXXXX") \
    || fail "could not create a temporary directory"
fi

key=$object_arg
case $key in
  tono-releases/*) key=${key#tono-releases/} ;;
esac
case $key in
  "$BACKUP_PREFIX"/*.sql.gz) ;;
  *.sql.gz)
    base=$(basename "$key")
    key=$BACKUP_PREFIX/$base
    ;;
  *)
    fail "object key must be $BACKUP_PREFIX/<stamp>.sql.gz (got $object_arg)"
    ;;
esac
case $key in
  *..*|*" "*) fail "object key looks unsafe: $key" ;;
esac

base=$(basename "$key")
gz=$work_dir/$base
sidecar=$gz.sha256
sql=$work_dir/${base%.gz}

file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    fail "need sha256sum or shasum to verify the dump"
  fi
}

# wrangler reads CLOUDFLARE_* from the environment. Do not `set -x`.
run_wrangler() {
  /usr/bin/env npx wrangler "$@"
}

cd "$control_plane"

run_wrangler r2 object get "$RELEASES_BUCKET/$key" \
  --file "$gz" --remote --config wrangler.jsonc \
  || fail "download of $key failed"
run_wrangler r2 object get "$RELEASES_BUCKET/$key.sha256" \
  --file "$sidecar" --remote --config wrangler.jsonc \
  || fail "download of $key.sha256 failed"

[ -f "$gz" ] || fail "download did not write $gz"
[ -f "$sidecar" ] || fail "download did not write $sidecar"

expected=$(awk '{print $1}' "$sidecar")
[ -n "$expected" ] || fail "sidecar $sidecar has no hash"
actual=$(file_sha256 "$gz")
[ "$expected" = "$actual" ] \
  || fail "sha256 mismatch for $base: sidecar $expected, file $actual"

gzip -dc "$gz" > "$sql" || fail "gunzip of $base failed"
[ -s "$sql" ] || fail "gunzip produced an empty SQL file"

# Belt: scan every execute argument so a future edit that interpolates the
# production name or the DB binding cannot actually run.
set -- d1 execute "$PREVIEW_D1_NAME" --remote --file "$sql" -y
for arg in "$@"; do
  if [ "$arg" = "$PRODUCTION_D1_NAME" ] || [ "$arg" = "DB" ]; then
    fail "refusing to run against production database $PRODUCTION_D1_NAME"
  fi
done

run_wrangler "$@" \
  || fail "d1 execute into $PREVIEW_D1_NAME failed"

printf 'restore-control-plane-d1-preview: imported %s into %s\n' \
  "$key" "$PREVIEW_D1_NAME"
