#!/bin/sh
# Nightly dump of the production control-plane D1 into the releases R2 bucket.
#
# The database holds accounts, catalog revisions, diagnostics indexes and
# usage rollups. Cloudflare's own D1 snapshots are not a restore path we
# control, so the dump has to live in an object we can get back. It goes in
# `tono-releases` (the RELEASES binding) rather than a new bucket so the same
# API token the deploy already uses can write it, and under `backups/` so a
# lifecycle rule can expire dumps without touching installers in the same
# bucket. That rule cannot be set from here; see docs/ops/d1-backups.md.
#
# Usage:
#   tooling/scripts/backup-control-plane-d1.sh [--dry-run] [--keep-local DIR]
#
# --dry-run    export, gzip, hash, then stop; nothing is uploaded.
# --keep-local DIR    leave the .sql.gz and .sha256 sidecar in DIR.
set -eu

PRODUCTION_D1_NAME=tono-control-plane
RELEASES_BUCKET=tono-releases
BACKUP_PREFIX=backups/control-plane-d1
# A real dump of this database is single-digit megabytes (see wrangler.jsonc).
# Wrangler can still exit 0 after writing a header-only file, an error page, or
# an empty schema when the export job did not actually run. 10 KiB is well
# below any genuine snapshot and well above those failure shapes, so a dump
# under this floor is refused rather than uploaded as a successful backup of
# nothing.
MIN_EXPORT_BYTES=10240

fail() {
  printf 'backup-control-plane-d1: %s\n' "$1" >&2
  exit 1
}

usage() {
  printf '%s\n' "usage: $0 [--dry-run] [--keep-local DIR]" >&2
}

dry_run=0
keep_local_dir=

while [ $# -gt 0 ]; do
  case $1 in
    --dry-run)
      dry_run=1
      shift
      ;;
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
    *)
      usage
      fail "unknown argument: $1"
      ;;
  esac
done

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
control_plane=$repo_root/services/control-plane
[ -f "$control_plane/wrangler.jsonc" ] \
  || fail "missing $control_plane/wrangler.jsonc"

if [ -n "$keep_local_dir" ]; then
  mkdir -p "$keep_local_dir" || fail "could not create $keep_local_dir"
  # Resolve before cd: the rest of the script runs from the Worker directory.
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
  work_dir=$(mktemp -d "${TMPDIR:-/tmp}/tono-cp-d1.XXXXXX") \
    || fail "could not create a temporary directory"
fi

stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
object_key=$BACKUP_PREFIX/$stamp.sql.gz
sql=$work_dir/$stamp.sql
gz=$work_dir/$stamp.sql.gz
sidecar=$gz.sha256

file_bytes() {
  # wc pads the number on some systems; the comparison is numeric.
  wc -c < "$1" | awk '{print $1}'
}

file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    fail "need sha256sum or shasum to hash the dump"
  fi
}

# wrangler reads CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID from the
# environment when they are set (CI). A laptop can use `wrangler login` instead.
# Do not `set -x` around these invocations: the token would land in the log.
run_wrangler() {
  /usr/bin/env npx wrangler "$@"
}

cd "$control_plane"

run_wrangler d1 export "$PRODUCTION_D1_NAME" --remote --output "$sql" \
  --config wrangler.jsonc -y \
  || fail "d1 export of $PRODUCTION_D1_NAME failed"

[ -f "$sql" ] || fail "export did not write $sql"

bytes=$(file_bytes "$sql")
if [ "$bytes" -lt "$MIN_EXPORT_BYTES" ]; then
  fail "export is ${bytes} bytes, below the ${MIN_EXPORT_BYTES}-byte (10 KiB) sanity floor; refusing to treat an empty or truncated dump as a backup"
fi

# -n omits the original filename and timestamp from the gzip header so two
# dumps of the same SQL hash the same. The sidecar is of the object we upload,
# not of the uncompressed SQL.
gzip -n -c "$sql" > "$gz" || fail "gzip failed"
rm -f "$sql"

hash=$(file_sha256 "$gz")
[ -n "$hash" ] || fail "could not hash the gzipped dump"
# sha256sum two-space format so `sha256sum -c` can verify the sidecar.
printf '%s  %s\n' "$hash" "$(basename "$gz")" > "$sidecar"

if [ "$dry_run" -eq 1 ]; then
  printf 'backup-control-plane-d1: dry-run %s (%s bytes uncompressed)\n' \
    "$object_key" "$bytes"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'object_key=%s\n' "$object_key" >> "$GITHUB_OUTPUT"
  fi
  exit 0
fi

run_wrangler r2 object put "$RELEASES_BUCKET/$object_key" \
  --file "$gz" --remote --config wrangler.jsonc \
  --content-type application/gzip -y \
  || fail "uploading $object_key failed"

run_wrangler r2 object put "$RELEASES_BUCKET/$object_key.sha256" \
  --file "$sidecar" --remote --config wrangler.jsonc \
  --content-type text/plain -y \
  || fail "uploading $object_key.sha256 failed"

printf 'backup-control-plane-d1: uploaded %s\n' "$object_key"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  printf 'object_key=%s\n' "$object_key" >> "$GITHUB_OUTPUT"
fi
