#!/bin/sh
# Move a hand-installed exit onto the pinned binary and the release layout,
# keeping its existing Reality keys. Runs on the exit, as root.
#
# Eight nodes were never provisioned by `provision-reality-node.rb`. They were
# installed by the public Xray one-click script and wired into /opt/tono-xray by
# hand, which is visible three ways: `current` is a real directory instead of a
# symlink, `releases/` is empty, and /usr/local/bin/xray is present. Six of them
# still run v25.3.6 — a year older than the pin — because the pin was never
# involved.
#
# This does NOT re-provision. Re-provisioning mints new Reality keys, and the
# catalog then has to be corrected in the same breath or every customer on that
# node fails; that exact mismatch cost about 24 hours on Los Angeles · Pacific.
# Keeping the keys means the catalog, the client identities and every installed
# client stay valid, and the only customer-visible event is one ~2 s restart.
#
# What it does change: the binary becomes the pinned build, and `current` becomes
# a symlink into `releases/<id>` — which is what makes a rollback possible at all.
# The previous directory is kept beside it, so this step is itself reversible.

set -eu

INSTALL=/opt/tono-xray
SERVICE=tono-xray.service

fail() { echo "migrate: $1" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "must run as root"

ARTIFACT=${1:-}
EXPECTED=${2:-}
[ -f "$ARTIFACT" ] || fail "uploaded binary not found at $ARTIFACT"
echo "$EXPECTED" | grep -qE '^[a-f0-9]{64}$' || fail "expected sha256 is malformed"
[ "$(sha256sum "$ARTIFACT" | awk '{print $1}')" = "$EXPECTED" ] || fail "uploaded binary digest mismatch"

[ -e "$INSTALL/current" ] || fail "no install at $INSTALL/current"
if [ -L "$INSTALL/current" ]; then
  echo "already on the release layout ($(readlink "$INSTALL/current")); leaving it alone"
  exit 0
fi
[ -d "$INSTALL/current" ] || fail "$INSTALL/current is neither a symlink nor a directory"
[ -f "$INSTALL/current/config.json" ] || fail "no config.json to carry over"

OLD_VER=$("$INSTALL/current/xray" version 2>/dev/null | head -1 | awk '{print $2}')
ID=$(date -u +%Y%m%dT%H%M%SZ)-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')
REL="$INSTALL/releases/$ID"

getent group tono-xray >/dev/null || fail "the tono-xray group is missing"
install -d -m 0755 -o root -g root "$INSTALL" "$INSTALL/releases"
install -d -m 0750 -o root -g tono-xray "$REL"
install -m 0755 -o root -g root "$ARTIFACT" "$REL/xray"

# Copied as late as possible: the ops hub rewrites this file every minute, and a
# copy taken early would silently drop an account added in between.
install -m 0640 -o root -g tono-xray "$INSTALL/current/config.json" "$REL/config.json"

"$REL/xray" run -test -config "$REL/config.json" >/dev/null 2>&1 \
  || fail "the pinned binary rejected the existing configuration; nothing was changed"

BACKUP="$INSTALL/current.pre-$ID"
mv "$INSTALL/current" "$BACKUP"
ln -s "$REL" "$INSTALL/current.new"
mv -T "$INSTALL/current.new" "$INSTALL/current"

restore() {
  rm -f "$INSTALL/current"
  mv "$BACKUP" "$INSTALL/current"
  systemctl restart "$SERVICE" >/dev/null 2>&1 || true
  fail "$1 — restored the previous directory"
}

systemctl restart "$SERVICE" >/dev/null 2>&1 || restore "the service did not restart"

ready=0
i=0
while [ $i -lt 60 ]; do
  if systemctl is-active --quiet "$SERVICE" && ss -H -ltn "sport = :$(python3 -c "
import json;c=json.load(open('$REL/config.json'))
print([i for i in c['inbounds'] if i.get('tag')=='tono-vless'][0]['port'])")" | grep -q .; then
    ready=1
    break
  fi
  i=$((i + 1))
  sleep 0.2
done
[ "$ready" = 1 ] || restore "the service did not come back listening"

NEW_VER=$("$INSTALL/current/xray" version 2>/dev/null | head -1 | awk '{print $2}')
[ -n "$NEW_VER" ] || restore "the new binary does not report a version"

echo "migrated $OLD_VER -> $NEW_VER, current -> releases/$ID, previous kept at $BACKUP"
