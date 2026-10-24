#!/bin/sh
# Install the versioned tono-exit-agent.timer cadence drop-in on an exit, as root.
# Leaves the deployed service/timer fragments alone; only the schedule changes.
# Idempotent: a host already carrying the exact drop-in with the live value is left alone.
set -eu

UNIT=tono-exit-agent.timer
DIR=/etc/systemd/system/$UNIT.d
DROPIN=$DIR/10-tono-cadence.conf
DESIRED="[Timer]
OnUnitInactiveSec=
OnUnitInactiveSec=60s"

fail() { echo "ensure-exit-agent-cadence: $1" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "must run as root"
command -v systemctl >/dev/null 2>&1 || fail "systemctl is required"
systemctl cat "$UNIT" >/dev/null 2>&1 || fail "$UNIT is not installed; provision the exit agent first"

live_ok() {
  systemctl show "$UNIT" -p TimersMonotonic --value 2>/dev/null \
    | grep -q "OnUnitInactiveUSec=1min"
}

if [ -f "$DROPIN" ] && [ "$(cat "$DROPIN")" = "$DESIRED" ] && live_ok; then
  echo "already at OnUnitInactiveSec=60s; leaving this host alone"
  exit 0
fi

umask 022
mkdir -p "$DIR"
printf '%s\n' "$DESIRED" > "$DROPIN.new"
mv -f "$DROPIN.new" "$DROPIN"
systemctl daemon-reload
systemctl restart "$UNIT"
live_ok || fail "$UNIT does not report OnUnitInactiveSec=60s after reload (another drop-in may override it)"
echo "tono-exit-agent.timer: OnUnitInactiveSec=60s"
