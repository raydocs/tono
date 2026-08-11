#!/bin/zsh
set -euo pipefail

# Written to reproduce the customer-facing fault of 2026-08-11 — long-lived
# streams dying mid-response every twenty minutes or so — on the belief that
# `api.reloadConfig` tore established connections down. It does not, and that is
# what this test is now for: it holds that belief to account.
#
# The real cause was one layer down. A re-arm flushes every PF state on the
# machine exactly when the new ruleset removes a pass rule the previous one had.
# The pin-refresh transaction arms twice, and its second arm had dropped the
# reviewed-bundle permit, so every refresh removed eight pass rules and became a
# machine-wide state flush. `KillSwitchManager.runLifecycleSelfTests` covers that
# pair directly.
#
# Keeping this is still worth it. It pins the property the diagnosis rests on: if
# a future mihomo does start severing connections on reload, the reasoning above
# stops holding and this fails instead of the conclusion silently rotting. It
# needs no root, no exit node, and no internet — a local listener stands in for
# the far end, because the question is whether an established stream survives an
# operation, not where it goes.

repo_root=${0:A:h:h:h}
mihomo=${TONO_TEST_MIHOMO_PATH:-"$repo_root/apps/macos/Tono/Resources/mihomo"}
if [[ $mihomo != /* || ! -x $mihomo ]]; then
  echo "TONO_TEST_MIHOMO_PATH must be an absolute executable path" >&2
  exit 2
fi

controller_port=29191
mixed_port=29192
echo_port=29193
for port in $controller_port $mixed_port $echo_port; do
  if /usr/sbin/lsof -nP -iTCP:"$port" 2>/dev/null | /usr/bin/grep -q .; then
    echo "test port $port is already in use" >&2
    exit 1
  fi
done

work=$(mktemp -d /tmp/tono-reload-test.XXXXXX)
core_pid=""
echo_pid=""
cleanup() {
  for pid in $core_pid $echo_pid; do
    if [[ -n $pid ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$work"
}
trap cleanup EXIT

secret="reload-test-$$"

write_config() {
  # $1 becomes an extra rule, so the two revisions differ the way a policy
  # change differs: same listeners and outbound, different routing table.
  cat > "$work/config.yaml" <<YAML
mixed-port: $mixed_port
external-controller: 127.0.0.1:$controller_port
secret: "$secret"
mode: rule
log-level: warning
ipv6: false
dns:
  enable: false
proxies: []
proxy-groups: []
rules:
$1  - MATCH,DIRECT
YAML
}

# A local listener that holds the stream open and echoes on demand, so
# "still connected" is proven by a fresh round trip rather than by the socket
# merely not having been reaped yet.
/usr/bin/python3 - "$echo_port" > "$work/echo.log" 2>&1 <<'PY' &
import socket, sys, threading
srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", int(sys.argv[1])))
srv.listen(8)
def serve(c):
    try:
        while True:
            d = c.recv(64)
            if not d:
                return
            c.sendall(d)
    except OSError:
        return
while True:
    conn, _ = srv.accept()
    threading.Thread(target=serve, args=(conn,), daemon=True).start()
PY
echo_pid=$!

write_config ""
"$mihomo" -d "$work" -f "$work/config.yaml" > "$work/core.log" 2>&1 &
core_pid=$!

ready=""
for _ in {1..60}; do
  if /usr/bin/curl -s -m 2 -H "Authorization: Bearer $secret" \
      "http://127.0.0.1:$controller_port/version" | /usr/bin/grep -q version; then
    ready=1
    break
  fi
  /bin/sleep 0.25
done
if [[ -z $ready ]]; then
  echo "isolated core did not become ready" >&2
  /usr/bin/tail -5 "$work/core.log" >&2 || true
  exit 1
fi

# Establish a stream through the core and prove it works before touching
# anything, so a later failure cannot be blamed on it never having worked.
/usr/bin/python3 - "$mixed_port" "$echo_port" "$work/result" <<'PY' &
import socket, sys, time
mixed, echo, result = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
def note(text):
    with open(result, "a") as handle:
        handle.write(text + "\n")
try:
    s = socket.create_connection(("127.0.0.1", mixed), timeout=8)
    s.sendall(f"CONNECT 127.0.0.1:{echo} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".encode())
    s.settimeout(8)
    head = s.recv(200)
    if b"200" not in head:
        note("setup-failed:" + repr(head[:60]))
        raise SystemExit
    s.sendall(b"before")
    if s.recv(64) != b"before":
        note("setup-failed:no-echo")
        raise SystemExit
    note("established")
    # Hold across the reload, then prove the same socket still carries data.
    time.sleep(6)
    try:
        s.sendall(b"after")
        s.settimeout(6)
        got = s.recv(64)
        note("survived" if got == b"after" else "wrong-echo:" + repr(got))
    except OSError as error:
        note(f"severed:{type(error).__name__}")
finally:
    pass
PY
stream_pid=$!

for _ in {1..40}; do
  [[ -f "$work/result" ]] && /usr/bin/grep -q . "$work/result" && break
  /bin/sleep 0.25
done
if ! /usr/bin/grep -q '^established$' "$work/result" 2>/dev/null; then
  echo "the stream never established, so nothing was tested: $(cat "$work/result" 2>/dev/null)" >&2
  exit 1
fi

# The operation under test: swap in a revised routing table exactly as applying
# a policy change does.
write_config "  - DOMAIN-SUFFIX,reload-probe.invalid,DIRECT
"
reload_status=$(/usr/bin/curl -s -o /dev/null -w '%{http_code}' -m 10 \
  -X PUT -H "Authorization: Bearer $secret" -H 'Content-Type: application/json' \
  --data "{\"path\": \"$work/config.yaml\"}" \
  "http://127.0.0.1:$controller_port/configs")
if [[ $reload_status != 204 && $reload_status != 200 ]]; then
  echo "reload was rejected (http $reload_status), so the test proved nothing" >&2
  /usr/bin/tail -5 "$work/core.log" >&2 || true
  exit 1
fi

wait $stream_pid 2>/dev/null || true
outcome=$(/usr/bin/tail -1 "$work/result" 2>/dev/null || echo "no-result")

case $outcome in
  survived)
    echo "reload preserved an established stream"
    ;;
  severed:*)
    echo "FAIL: reloading the config severed an established stream ($outcome)" >&2
    echo "  This did not happen when the reasoning about the 2026-08-11" >&2
    echo "  incident was formed, and that reasoning concluded the PF state" >&2
    echo "  flush was solely responsible. If reload severs connections now," >&2
    echo "  that conclusion no longer holds and applying policy to a live" >&2
    echo "  session needs rethinking, not just the arm sequence." >&2
    exit 1
    ;;
  *)
    echo "FAIL: inconclusive outcome ($outcome)" >&2
    exit 1
    ;;
esac
