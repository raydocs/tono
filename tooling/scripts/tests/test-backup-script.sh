#!/bin/sh
# Exercise backup-control-plane-d1.sh without talking to Cloudflare.
#
# A stub `npx` on PATH writes a fake D1 export. --dry-run must never reach
# `r2 object put`; the stub fails the run if it does. The size floor and the
# sha256 sidecar are the two things this can check without credentials.
set -eu

fail() {
  printf 'test-backup-script: FAIL: %s\n' "$1" >&2
  exit 1
}

pass() {
  printf 'ok: %s\n' "$1"
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
backup=$script_dir/../backup-control-plane-d1.sh
[ -f "$backup" ] || fail "missing backup-control-plane-d1.sh"

root=$(mktemp -d "${TMPDIR:-/tmp}/tono-backup-test.XXXXXX")
trap 'rm -rf "$root"' 0 INT HUP TERM

mkdir -p "$root/bin" "$root/keep-ok" "$root/keep-small"

cat > "$root/bin/npx" <<'STUB'
#!/bin/sh
set -eu
output=
prev=
is_export=0
is_put=0
for arg in "$@"; do
  if [ "$arg" = export ]; then
    is_export=1
  fi
  if [ "$arg" = put ]; then
    is_put=1
  fi
  if [ "$prev" = --output ]; then
    output=$arg
  fi
  prev=$arg
done
if [ "$is_put" -eq 1 ]; then
  printf 'npx stub: r2 object put must not run under --dry-run\n' >&2
  exit 1
fi
if [ "$is_export" -eq 1 ] && [ -n "$output" ]; then
  size=${BACKUP_STUB_BYTES:-12288}
  python3 -c "import os, sys
path = sys.argv[1]
n = int(os.environ.get('BACKUP_STUB_BYTES', '12288'))
open(path, 'w', encoding='utf-8').write('-- tono-control-plane stub export\\n' + ('x' * n) + '\\n')
" "$output"
  exit 0
fi
printf 'npx stub: unexpected: %s\n' "$*" >&2
exit 1
STUB
chmod +x "$root/bin/npx"

# Prefer the stub over a real npx. /usr/bin/env npx in the backup script
# searches this PATH.
PATH=$root/bin:$PATH
export PATH
export BACKUP_STUB_BYTES

checks=0

# --- size floor: a header-sized dump is not a backup -----------------------
BACKUP_STUB_BYTES=100
set +e
sh "$backup" --dry-run --keep-local "$root/keep-small" >"$root/small.out" 2>"$root/small.err"
small_status=$?
set -e
[ "$small_status" -ne 0 ] || fail "export below 10 KiB was accepted"
grep -q "10 KiB" "$root/small.err" || fail "size-floor error did not mention 10 KiB: $(cat "$root/small.err")"
checks=$((checks + 1))
pass "export below 10 KiB is refused"

# --- happy path: gzip + sidecar hash ---------------------------------------
BACKUP_STUB_BYTES=12000
sh "$backup" --dry-run --keep-local "$root/keep-ok" >"$root/ok.out" 2>"$root/ok.err" \
  || fail "export above the floor failed: $(cat "$root/ok.err")"

gz=
for candidate in "$root/keep-ok"/*.sql.gz; do
  [ -f "$candidate" ] || continue
  gz=$candidate
  break
done
[ -n "$gz" ] || fail "gzipped dump was not kept in --keep-local"
sidecar=$gz.sha256
[ -f "$sidecar" ] || fail "sha256 sidecar was not kept"

gzip -t "$gz" || fail "kept file is not valid gzip"
checks=$((checks + 1))
pass "kept dump is valid gzip"

if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$gz" | awk '{print $1}')
else
  actual=$(shasum -a 256 "$gz" | awk '{print $1}')
fi
listed=$(awk '{print $1}' "$sidecar")
[ -n "$listed" ] || fail "sidecar is empty"
[ "$actual" = "$listed" ] || fail "sidecar hash $listed != file hash $actual"
checks=$((checks + 1))
pass "sha256 sidecar matches the gzipped dump"

grep -q "dry-run backups/control-plane-d1/" "$root/ok.out" \
  || fail "dry-run did not print the object key: $(cat "$root/ok.out")"
checks=$((checks + 1))
pass "dry-run prints the object key and does not upload"

printf 'test-backup-script: %s checks passed\n' "$checks"
