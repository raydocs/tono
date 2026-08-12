#!/bin/zsh
# Route classification and byte accounting for the per-app traffic ledger.
#
# Compiles the real AppTrafficLedger source against minimal stand-ins for the two
# Mihomo models it reads. The interesting cases are the ones that stay plausible
# when wrong: a closed connection losing its bytes, a reused connection id
# subtracting, and a residential flow being filed as tunnel because its chain
# also carries the exit it was dialled through.
set -euo pipefail

repo_root=${0:A:h:h:h}
tono_developer_dir=/Applications/Xcode.app/Contents/Developer
test_dir=$(mktemp -d /tmp/tono-ledger.XXXXXX)
trap 'rm -rf "$test_dir"' EXIT

DEVELOPER_DIR="$tono_developer_dir" /usr/bin/xcrun swiftc \
  -O \
  -module-cache-path "$test_dir/module-cache" \
  "$repo_root/apps/macos/Tono/Services/AppTrafficLedger.swift" \
  "$repo_root/tooling/scripts/tests/AppTrafficLedgerTests.swift" \
  -o "$test_dir/ledger-tests"

"$test_dir/ledger-tests"
