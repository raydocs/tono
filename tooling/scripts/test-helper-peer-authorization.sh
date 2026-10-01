#!/bin/sh
set -eu

# The helper accepts a peer only when Security.framework reports
# `anchor apple generic`, identifier com.raydocs.tono, team OU YY57758GS7,
# and no get-task-allow entitlement. That requirement does not name an
# Apple Development leaf. Developer ID certificates carry the same team OU,
# so the identity the release imports can satisfy the allow case. A
# certificate made in a temporary keychain is not an Apple anchor, so hosted
# macOS CI runs the reject cases and says the allow case did not run.
# A release refuses to continue only when the imported Developer ID identity
# is missing.

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
temporary_dir=$(mktemp -d "/tmp/tono-peer-auth.XXXXXX")
case "$temporary_dir" in
  /tmp/tono-peer-auth.*) ;;
  *) echo "unexpected temporary directory" >&2; exit 2 ;;
esac

keychain_path=
saved_keychains=
trusted_cert=
release_keychain=
plan_only=0
if [ "${1:-}" = "--plan" ]; then
  plan_only=1
fi

cleanup() {
  status=$?
  trap - EXIT
  if [ -n "$trusted_cert" ]; then
    sudo -n security remove-trusted-cert -d "$trusted_cert" >/dev/null 2>&1 || true
  fi
  if [ -n "$keychain_path" ]; then
    security delete-keychain "$keychain_path" >/dev/null 2>&1 || true
  fi
  if [ -n "$saved_keychains" ]; then
    # Paths come from `security list-keychains` and contain no spaces.
    # shellcheck disable=SC2086
    security list-keychains -d user -s $saved_keychains >/dev/null 2>&1 || true
  fi
  find "$temporary_dir" -depth -delete
  exit "$status"
}
trap cleanup EXIT

peer_auth_mode() {
  if [ -n "${TONO_PEER_AUTH_MODE:-}" ]; then
    printf '%s' "$TONO_PEER_AUTH_MODE"
    return
  fi
  case ${GITHUB_WORKFLOW_REF:-} in
    *macos-release.yml*) printf '%s' release ;;
    *macos-ci.yml*) printf '%s' ci ;;
    *)
      if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
        printf '%s' ci
      else
        printf '%s' local
      fi
      ;;
  esac
}

find_apple_development_identity() {
  if [ "${TONO_PEER_AUTH_IDENTITY+x}" = "x" ]; then
    printf '%s' "$TONO_PEER_AUTH_IDENTITY"
    return
  fi
  security find-identity -v -p codesigning 2>/dev/null |
    awk '/Apple Development: Ruirui Wan/ { print $2; exit }'
}

# Sets $identity to the codesign hash of the imported Developer ID identity,
# or exits 1 when that identity was not imported. --plan keeps the name and
# does not touch the keychain.
resolve_release_identity() {
  label=
  if [ -n "${TONO_PEER_AUTH_IDENTITY:-}" ]; then
    label=$TONO_PEER_AUTH_IDENTITY
  elif [ -n "${MACOS_DEVELOPER_ID_APPLICATION_IDENTITY:-}" ]; then
    label=$MACOS_DEVELOPER_ID_APPLICATION_IDENTITY
  fi
  if [ -z "$label" ]; then
    echo "helper peer authorization: release requires the imported Developer ID identity; refusing to skip" >&2
    exit 1
  fi
  if [ "$plan_only" -eq 1 ]; then
    identity=$label
    return
  fi
  # The release job puts the Developer ID private key only in KEYCHAIN_PATH.
  # Search that keychain, not the login keychain. Do not assign it to
  # keychain_path: cleanup deletes keychain_path, and this one must survive
  # for the notarized archive.
  if [ -n "$release_keychain" ]; then
    identity=$(security find-identity -v -p codesigning "$release_keychain" 2>/dev/null |
      awk -v name="$label" 'index($0, "\"" name "\"") { print $2; exit }')
  else
    identity=$(security find-identity -v -p codesigning 2>/dev/null |
      awk -v name="$label" 'index($0, "\"" name "\"") { print $2; exit }')
  fi
  if [ -z "$identity" ]; then
    echo "helper peer authorization: Developer ID identity is not in the keychain; refusing to skip" >&2
    exit 1
  fi
}

note_allow_skipped() {
  echo "::warning title=Helper peer authorization::Apple Development identity is absent. anchor apple generic cannot be satisfied by a self-signed certificate, so the allow case did not run. Reject cases still run." >&2
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    cat >>"$GITHUB_STEP_SUMMARY" <<'EOF'
### Helper peer authorization

The Apple Development identity `Apple Development: Ruirui Wan` is not in this keychain.
The allow case did not run: `anchor apple generic` plus team OU `YY57758GS7` cannot be met by a throwaway self-signed certificate.
Reject cases still run (ad-hoc, and a self-signed identity when this runner can sign with one).
EOF
  fi
}

mode=$(peer_auth_mode)
case $mode in
  release|ci|local) ;;
  *)
    echo "helper peer authorization: unknown TONO_PEER_AUTH_MODE: $mode" >&2
    exit 2
    ;;
esac
if [ "$mode" = "release" ]; then
  release_keychain=${KEYCHAIN_PATH:-}
  resolve_release_identity
else
  identity=$(find_apple_development_identity)
fi

if [ "$plan_only" -eq 1 ]; then
  if [ -n "$identity" ]; then
    printf '%s\n' allow reject-adhoc reject-wrong-id reject-get-task-allow
    exit 0
  fi
  case $mode in
    release)
      echo "helper peer authorization: release requires the imported Developer ID identity; refusing to skip" >&2
      exit 1
      ;;
    ci)
      note_allow_skipped
      printf '%s\n' reject-adhoc reject-self-signed-wrong-id reject-self-signed-get-task-allow reject-self-signed-right-id
      exit 0
      ;;
    local)
      echo "SKIP: no Apple Development identity for the Tono team" >&2
      exit 0
      ;;
  esac
fi

if [ -z "$identity" ] && [ "$mode" = "release" ]; then
  echo "helper peer authorization: release requires the imported Developer ID identity; refusing to skip" >&2
  exit 1
fi
if [ -z "$identity" ] && [ "$mode" = "local" ]; then
  echo "SKIP: no Apple Development identity for the Tono team" >&2
  exit 0
fi

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

sign_client() {
  chosen_keychain=
  if [ "$signing_identity" != "-" ]; then
    if [ -n "$keychain_path" ]; then
      chosen_keychain=$keychain_path
    elif [ -n "$release_keychain" ]; then
      chosen_keychain=$release_keychain
    fi
  fi
  if [ -n "$entitlements" ] && [ -n "$chosen_keychain" ]; then
    codesign --force --sign "$signing_identity" --keychain "$chosen_keychain" \
      --identifier "$identifier" --entitlements "$entitlements" "$client" || return 2
  elif [ -n "$entitlements" ]; then
    codesign --force --sign "$signing_identity" \
      --identifier "$identifier" --entitlements "$entitlements" "$client" || return 2
  elif [ -n "$chosen_keychain" ]; then
    codesign --force --sign "$signing_identity" --keychain "$chosen_keychain" \
      --identifier "$identifier" "$client" || return 2
  else
    codesign --force --sign "$signing_identity" --identifier "$identifier" "$client" || return 2
  fi
}

run_case() {
  expected=$1
  identifier=$2
  signing_identity=$3
  entitlements=${4:-}
  socket_path="$temporary_dir/$expected-$identifier-$(printf %s "$entitlements" | wc -c | tr -d ' ').sock"
  sign_client || return 2
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
  "$client" "$socket_path" || exit 1
  wait "$server_pid"
}

run_optional_reject() {
  status=0
  run_case "$@" || status=$?
  if [ "$status" -eq 0 ]; then
    return 0
  fi
  if [ "$status" -eq 2 ]; then
    echo "::warning title=Helper peer authorization::Could not sign a throwaway reject case ($2). That case did not run." >&2
    return 0
  fi
  exit "$status"
}

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

if [ -n "$identity" ]; then
  run_case allow com.raydocs.tono "$identity" || exit 1
  run_case reject com.raydocs.tono - || exit 1
  run_case reject com.raydocs.not-tono "$identity" || exit 1
  # A correct identity is not sufficient. A build carrying get-task-allow can be
  # attached to and injected into by any process running as the same user, so an
  # attacker never has to satisfy the requirement themselves — they borrow a
  # process that already does, and with it the ability to arm and disarm PF and to
  # start the privileged core. Apple Development certificates carry this team's OU
  # exactly like Developer ID ones, so only the entitlement separates a debuggable
  # local build from a shipped one.
  run_case reject com.raydocs.tono "$identity" "$debuggable_entitlements" || exit 1
  echo "helper peer authorization tests passed"
  exit 0
fi

note_allow_skipped
run_case reject com.raydocs.tono - || exit 1

create_throwaway_identity() {
  keychain_path=$temporary_dir/peer-auth.keychain-db
  password=$(openssl rand -hex 16) || return 1
  cn="Tono Peer Auth CI"
  saved_keychains=$(security list-keychains -d user | tr -d '"' | tr '\n' ' ') || return 1
  security create-keychain -p "$password" "$keychain_path" || return 1
  security set-keychain-settings -lut 3600 "$keychain_path" || return 1
  security unlock-keychain -p "$password" "$keychain_path" || return 1
  # shellcheck disable=SC2086
  security list-keychains -d user -s "$keychain_path" $saved_keychains || return 1

  cat >"$temporary_dir/codesign.cnf" <<EOF
[ req ]
distinguished_name = req_distinguished_name
prompt = no
[ req_distinguished_name ]
CN = $cn
OU = YY57758GS7
O = Tono CI
[ v3_req ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature
extendedKeyUsage = codeSigning
EOF
  openssl req -new -x509 -nodes -newkey rsa:2048 -days 1 \
    -config "$temporary_dir/codesign.cnf" -extensions v3_req \
    -keyout "$temporary_dir/key.pem" -out "$temporary_dir/cert.pem" || return 1
  openssl pkcs12 -export \
    -inkey "$temporary_dir/key.pem" -in "$temporary_dir/cert.pem" \
    -out "$temporary_dir/cert.p12" -passout "pass:$password" -name "$cn" || return 1
  security import "$temporary_dir/cert.p12" -k "$keychain_path" -P "$password" -A -f pkcs12 || return 1
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain_path" || return 1
  throwaway_hash=$(security find-certificate -c "$cn" -Z "$keychain_path" | awk '/SHA-1 hash:/{print $3; exit}') || return 1
  if [ -z "$throwaway_hash" ]; then
    return 1
  fi
  cp "$client" "$temporary_dir/sign-probe" || return 1
  if ! python3 -c 'import subprocess,sys; subprocess.run(sys.argv[1:], check=True, timeout=20)' \
    codesign --force --sign "$throwaway_hash" --keychain "$keychain_path" "$temporary_dir/sign-probe"; then
    sudo -n security add-trusted-cert -d -r trustRoot -p codeSign \
      -k /Library/Keychains/System.keychain "$temporary_dir/cert.pem" || return 1
    trusted_cert=$temporary_dir/cert.pem
    python3 -c 'import subprocess,sys; subprocess.run(sys.argv[1:], check=True, timeout=20)' \
      codesign --force --sign "$throwaway_hash" --keychain "$keychain_path" "$temporary_dir/sign-probe" || return 1
  fi
}

if create_throwaway_identity; then
  run_optional_reject reject com.raydocs.not-tono "$throwaway_hash"
  run_optional_reject reject com.raydocs.tono "$throwaway_hash" "$debuggable_entitlements"
  # Same identifier and no get-task-allow as the allow case. Production still
  # rejects it: the certificate is not anchored at Apple.
  run_optional_reject reject com.raydocs.tono "$throwaway_hash"
else
  echo "::warning title=Helper peer authorization::Throwaway code-signing identity could not be created. Only the ad-hoc reject case ran." >&2
fi
echo "helper peer authorization: reject cases ran; the Apple Development allow case did not"
