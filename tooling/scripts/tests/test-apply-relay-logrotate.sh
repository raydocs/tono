#!/bin/sh
# apply-relay.sh --logrotate-only installs the canonical relay logrotate file as
# <logrotate.d>/00-tono-relay with mode 0644 and leaves nginx untouched.
#
# Stubs on PATH: `logrotate` reports 3.21.0 and a clean `-d`; `nginx`, `systemctl` and
# `apt-get` fail the run if the script reaches them.
set -eu

fail() {
  printf 'test-apply-relay-logrotate: FAIL: %s\n' "$1" >&2
  exit 1
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
relay=$script_dir/../../ops/relay
[ -f "$relay/apply-relay.sh" ] || fail "missing apply-relay.sh"

root=$(mktemp -d "${TMPDIR:-/tmp}/tono-relay-logrotate-test.XXXXXX")
trap 'rm -rf "$root"' 0 INT HUP TERM
mkdir -p "$root/bin" "$root/src" "$root/logrotate.d"
cp "$relay/tono-relay.logrotate" "$root/src/"

cat > "$root/bin/logrotate" <<'STUB'
#!/bin/sh
case "${1:-}" in
  --version) echo "logrotate 3.21.0" ;;
  -d) echo "reading config file $2" ;;
  *) exit 2 ;;
esac
STUB
for tool in nginx systemctl apt-get; do
  printf '#!/bin/sh\necho "unexpected %s" >&2\nexit 9\n' "$tool" > "$root/bin/$tool"
done
chmod +x "$root/bin/"*

PATH="$root/bin:$PATH" \
  TONO_RELAY_SRC="$root/src" \
  TONO_RELAY_LOGROTATE_D="$root/logrotate.d" \
  TONO_RELAY_LOGROTATE_CONF="$root/logrotate.conf" \
  bash "$relay/apply-relay.sh" --logrotate-only > "$root/out" 2>&1 || {
    cat "$root/out" >&2
    fail "apply-relay.sh --logrotate-only exited non-zero"
  }

dest=$root/logrotate.d/00-tono-relay
[ -f "$dest" ] || fail "00-tono-relay not installed"
cmp -s "$relay/tono-relay.logrotate" "$dest" || fail "installed file differs from canonical copy"
mode=$(stat -c %a "$dest" 2>/dev/null || stat -f %Lp "$dest")
[ "$mode" = 644 ] || fail "mode $mode, want 644"
printf 'ok: apply-relay.sh --logrotate-only installs 00-tono-relay 0644\n'
