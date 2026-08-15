#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
temporary_dir=$(mktemp -d "/tmp/tono-peer-auth.XXXXXX")
case "$temporary_dir" in
  /tmp/tono-peer-auth.*) ;;
  *) echo "unexpected temporary directory" >&2; exit 2 ;;
esac
cleanup() {
  status=$?
  trap - EXIT
  find "$temporary_dir" -depth -delete
  exit "$status"
}
trap cleanup EXIT

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
server="$temporary_dir/auth-server"
client="$temporary_dir/auth-client"
xcrun swiftc \
  -module-cache-path "$temporary_dir/module-cache" \
  "$repo_dir/tooling/scripts/helper-tests/auth-server/main.swift" \
  "$repo_dir/tooling/scripts/helper-shared/PeerAuthorization.swift" \
  -framework Security \
  -o "$server"
xcrun swiftc \
  -module-cache-path "$temporary_dir/module-cache" \
  "$repo_dir/tooling/scripts/helper-tests/auth-client/main.swift" \
  -o "$client"

identity=$(
  security find-identity -v -p codesigning |
    awk '/Apple Development: Ruirui Wan/ { print $2; exit }'
)
if [ -z "$identity" ]; then
  echo "SKIP: no Apple Development identity for the Tono team" >&2
  exit 0
fi

run_case() {
  expected=$1
  identifier=$2
  signing_identity=$3
  entitlements=${4:-}
  socket_path="$temporary_dir/$expected-$identifier-$(printf %s "$entitlements" | wc -c | tr -d ' ').sock"
  if [ -n "$entitlements" ]; then
    codesign --force --sign "$signing_identity" --identifier "$identifier" \
      --entitlements "$entitlements" "$client"
  else
    codesign --force --sign "$signing_identity" --identifier "$identifier" "$client"
  fi
  "$server" "$socket_path" "$expected" &
  server_pid=$!
  # A wall-clock deadline, not a fixed count of 10 ms naps. The previous budget
  # came to one second, which a freshly re-signed binary misses on its first
  # exec while the rest of the suite has the machine busy — and this is a
  # release gate, so a failure that means "the Mac was loaded" is worse than no
  # gate at all: it teaches everyone to wave the next real one through.
  deadline=$(( $(date +%s) + 30 ))
  while [ ! -S "$socket_path" ]; do
    if ! kill -0 "$server_pid" 2>/dev/null; then
      wait "$server_pid" 2>/dev/null || true
      echo "authorization test server exited before it listened" >&2
      exit 1
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      kill "$server_pid" 2>/dev/null || true
      wait "$server_pid" 2>/dev/null || true
      echo "authorization test server did not start within 30s" >&2
      exit 1
    fi
    sleep 0.05
  done
  "$client" "$socket_path"
  wait "$server_pid"
}

run_case allow com.raydocs.tono "$identity"
run_case reject com.raydocs.tono -
run_case reject com.raydocs.not-tono "$identity"

# A correct identity is not sufficient. A build carrying get-task-allow can be
# attached to and injected into by any process running as the same user, so an
# attacker never has to satisfy the requirement themselves — they borrow a
# process that already does, and with it the ability to arm and disarm PF and to
# start the privileged core. Apple Development certificates carry this team's OU
# exactly like Developer ID ones, so only the entitlement separates a debuggable
# local build from a shipped one.
debuggable_entitlements="$temporary_dir/debuggable.plist"
cat >"$debuggable_entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.get-task-allow</key>
	<true/>
</dict>
</plist>
PLIST
run_case reject com.raydocs.tono "$identity" "$debuggable_entitlements"
echo "helper peer authorization tests passed"
