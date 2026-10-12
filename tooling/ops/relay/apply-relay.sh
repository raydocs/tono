#!/bin/bash
# Runs on a relay node as root. Expects /root/tono-relay.stream.conf and
# /root/tono-relay.logrotate (copied from tooling/ops/relay/) next to it. Backs up
# nginx.conf, installs the stream module if missing, includes the relay config, reloads
# only when `nginx -t` passes, else restores; then installs the relay log rotation.
# `--logrotate-only` installs only the log rotation and leaves nginx untouched.
set -euo pipefail
SRC=${TONO_RELAY_SRC:-/root}
LOGROTATE_D=${TONO_RELAY_LOGROTATE_D:-/etc/logrotate.d}
LOGROTATE_CONF=${TONO_RELAY_LOGROTATE_CONF:-/etc/logrotate.conf}

# /etc/logrotate.d/00-tono-relay sorts before the distro's `nginx` file, whose
# /var/log/nginx/*.log glob also matches the relay logs; `ignoreduplicates` (logrotate
# 3.21+) makes that glob skip them. Older logrotate rejects the directive, so skip there:
# the distro stanza still rotates the relay logs daily with 14 kept (no dateext).
install_logrotate() {
  local have dest out
  dest=$LOGROTATE_D/00-tono-relay
  have=$(logrotate --version 2>&1 | awk 'NR==1 {print $2}') || have=
  if [ -z "$have" ] || [ "$(printf '%s\n3.21.0\n' "$have" | sort -V | head -n1)" != 3.21.0 ]; then
    echo "SKIP logrotate: need >= 3.21.0 for ignoreduplicates, have '${have:-none}'; distro nginx stanza still rotates the relay logs"
    return 0
  fi
  install -m 0644 "$SRC/tono-relay.logrotate" "$dest"
  out=$(logrotate -d "$LOGROTATE_CONF" 2>&1) || true
  if printf '%s\n' "$out" | grep -E '^error: .*(00-tono-relay|duplicate log entry)'; then
    rm -f "$dest"
    echo "REMOVED $dest: logrotate -d rejected it"
    return 1
  fi
  echo "OK logrotate $dest"
}

[ -f "$SRC/tono-relay.logrotate" ] || { echo "missing $SRC/tono-relay.logrotate" >&2; exit 1; }
# A minimal image may lack logrotate; without it the relay logs would grow unbounded.
if ! command -v logrotate >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q logrotate >/dev/null
fi
if [ "${1:-}" = --logrotate-only ]; then
  install_logrotate
  exit 0
fi
[ -f "$SRC/tono-relay.stream.conf" ] || { echo "missing $SRC/tono-relay.stream.conf" >&2; exit 1; }

TS=$(date -u +%Y%m%dT%H%M%SZ)
CONF=/etc/nginx/nginx.conf
BAK=$CONF.bak-$TS-pre-tono-relay-v2
cp "$CONF" "$BAK"
if ! ls /usr/lib/nginx/modules/ngx_stream_module.so >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q libnginx-mod-stream >/dev/null
fi
# Debian's libnginx-mod-stream already loads the module from modules-enabled; a second
# load_module line in nginx.conf fails `nginx -t` ("already loaded").
STREAM_PRELOADED=0
if grep -qs 'ngx_stream_module.so' /etc/nginx/modules-enabled/*.conf; then STREAM_PRELOADED=1; fi
install -m 0644 "$SRC/tono-relay.stream.conf" /etc/nginx/tono-relay.stream.conf
python3 - "$CONF" "$STREAM_PRELOADED" <<'PY'
import re,sys
p=sys.argv[1]; preloaded=sys.argv[2]=="1"; s=open(p).read()
# drop any inline stream block we wrote before
s=re.sub(r"\nstream \{\n.*?\n\}\n", "\n", s, count=1, flags=re.S)
if "ngx_stream_module.so" not in s and not preloaded:
    s="load_module /usr/lib/nginx/modules/ngx_stream_module.so;\n"+s
if "tono-relay.stream.conf" not in s:
    s=s.rstrip("\n")+"\nstream {\n    include /etc/nginx/tono-relay.stream.conf;\n}\n"
open(p,"w").write(s)
PY
if nginx -t 2>/tmp/nginx-t.err; then
  systemctl reload nginx
  echo "OK reload; backup $BAK"
else
  cat /tmp/nginx-t.err
  cp "$BAK" "$CONF"; nginx -t && echo "ROLLED BACK to $BAK"; exit 1
fi
install_logrotate
ss -ltn | grep -c ':2053 '
systemctl is-active nginx
systemctl is-active tono-xray 2>/dev/null || true
