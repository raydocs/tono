#!/bin/bash
# Runs on a relay node as root. Expects /root/tono-relay.stream.conf (copied from
# tooling/ops/relay/) next to it. Backs up nginx.conf, installs the stream module if
# missing, includes the relay config, reloads only when `nginx -t` passes, else restores.
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
CONF=/etc/nginx/nginx.conf
BAK=$CONF.bak-$TS-pre-tono-relay-v2
cp "$CONF" "$BAK"
if ! ls /usr/lib/nginx/modules/ngx_stream_module.so >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q libnginx-mod-stream >/dev/null
fi
install -m 0644 /root/tono-relay.stream.conf /etc/nginx/tono-relay.stream.conf
python3 - "$CONF" <<'PY'
import re,sys
p=sys.argv[1]; s=open(p).read()
# drop any inline stream block we wrote before
s=re.sub(r"\nstream \{\n.*?\n\}\n", "\n", s, count=1, flags=re.S)
if "ngx_stream_module.so" not in s:
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
ss -ltn | grep -c ':2053 '
systemctl is-active nginx tono-xray
