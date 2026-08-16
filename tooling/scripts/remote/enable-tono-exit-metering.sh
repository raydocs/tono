#!/bin/sh
# Enable per-account metering on a deployed Tono exit. Runs on the exit, as root.
#
# Turns on statistics, per-user counters, and the management API the metering
# agent needs. It does not issue identities and does not touch anything else: the
# credential every current client holds is kept, so the fleet keeps working while
# accounts are migrated to their own.
#
# One disconnection per exit, once. Adding the management interface needs a
# restart, because the interface it would otherwise be added through does not
# exist yet. Nothing here can avoid that, so run it one node at a time and let
# clients reconnect between them. A node that is already metered is detected and
# left alone, without a restart.
#
# Everything is checked before anything is replaced: the generated configuration
# is validated by the installed xray, and the previous one is kept so a failed
# start can be undone.

set -eu

SERVICE_NAME="tono-xray.service"
INSTALL_ROOT="/opt/tono-xray"
CONFIG="$INSTALL_ROOT/current/config.json"
XRAY="$INSTALL_ROOT/current/xray"
TRANSFORM="$(dirname "$0")/exit_metering_config.py"

fail() {
  echo "enable-tono-exit-metering: $1" >&2
  exit 1
}

[ "$(id -u)" = 0 ] || fail "must run as root: it replaces a root-owned configuration and restarts a service"
[ -f "$CONFIG" ] || fail "no deployed configuration at $CONFIG"
[ -x "$XRAY" ] || fail "no xray binary at $XRAY"
[ -f "$TRANSFORM" ] || fail "exit_metering_config.py must sit beside this script"
command -v python3 >/dev/null 2>&1 || fail "python3 is required to edit the configuration"

work="$(mktemp -d /tmp/tono-exit-metering.XXXXXX)"
trap 'rm -rf "$work"' EXIT
chmod 0700 "$work"

# Nothing to do is the common case on a re-run, and finding that out must not
# cost a disconnection.
#
# The program is passed with -c rather than on stdin. It used to be a heredoc
# *and* `< "$CONFIG"`, which is two stdin redirections: the heredoc won, so
# python read its own source as the configuration, `json.load` hit EOF, and the
# probe exited non-zero every time. That landed in the branch below and printed
# "already metered" — so this script reported success without ever metering
# anything, on every node it was ever run against.
#
# The three outcomes are kept distinct too. A crashed probe used to be
# indistinguishable from "no changes needed", which is what let the bug above
# read as a clean no-op for as long as it did.
set +e
python3 -c '
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("config", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
raise SystemExit(0 if module.needs_changes(json.load(sys.stdin)) else 3)
' "$TRANSFORM" < "$CONFIG"
probe=$?
set -e
case "$probe" in
  0) ;;
  3)
    echo "already metered; leaving the service alone"
    exit 0
    ;;
  *)
    fail "could not read $CONFIG to decide whether this exit is already metered (probe exit $probe)"
    ;;
esac

python3 "$TRANSFORM" < "$CONFIG" > "$work/config.json" \
  || fail "the configuration could not be edited"

# The installed xray decides whether this is acceptable, not the editor. Checked
# before the running configuration is touched.
"$XRAY" run -test -config "$work/config.json" >/dev/null 2>&1 \
  || fail "xray rejected the generated configuration; nothing was changed"

# Ownership and mode are copied from what is deployed rather than assumed: the
# service runs as its own user and cannot read a root-only file.
owner="$(stat -c '%U:%G' "$CONFIG")"
mode="$(stat -c '%a' "$CONFIG")"
backup="$CONFIG.pre-metering.$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$CONFIG" "$backup"
install -o "${owner%:*}" -g "${owner#*:}" -m "$mode" "$work/config.json" "$CONFIG.new"
mv -f "$CONFIG.new" "$CONFIG"

echo "restarting $SERVICE_NAME (this drops live sessions on this node)"
if ! systemctl restart "$SERVICE_NAME"; then
  mv -f "$backup" "$CONFIG"
  systemctl restart "$SERVICE_NAME" || true
  fail "the service did not restart; the previous configuration was put back"
fi

# A service that starts and then exits is worse than one that refuses to start,
# because the failure is quiet. Give it a moment and confirm it is still up.
sleep 3
if ! systemctl is-active --quiet "$SERVICE_NAME"; then
  mv -f "$backup" "$CONFIG"
  systemctl restart "$SERVICE_NAME" || true
  fail "the service did not stay running; the previous configuration was put back"
fi

# Prove the management interface actually answers. Configured-but-unreachable is
# the failure that would otherwise be discovered later, by an agent reporting
# nothing and looking like an exit with no accounts on it.
if ! "$XRAY" api statsquery --server=127.0.0.1:10085 >/dev/null 2>&1; then
  echo "warning: the service is running but the management API did not answer on" >&2
  echo "  127.0.0.1:10085. The metering agent cannot work until it does; check" >&2
  echo "  this node before relying on its usage numbers." >&2
  echo "  Previous configuration kept at $backup" >&2
  exit 1
fi

echo "metering enabled; previous configuration kept at $backup"
