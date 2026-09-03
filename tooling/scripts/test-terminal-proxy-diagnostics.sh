#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
test_dir=$(mktemp -d /tmp/tono-terminal-proxy.XXXXXX)
trap 'rm -rf "$test_dir"' EXIT

if command -v swiftc >/dev/null 2>&1; then
  compiler=(swiftc)
elif [[ $(uname -s) == Darwin ]] && command -v xcrun >/dev/null 2>&1; then
  compiler=(xcrun swiftc)
else
  echo "swiftc is unavailable" >&2
  exit 2
fi

"${compiler[@]}" \
  "$repo_root/apps/macos/Tono/Support/TerminalProxyDiagnostics.swift" \
  "$repo_root/tooling/scripts/tests/TerminalProxyDiagnosticsTests.swift" \
  -o "$test_dir/test-terminal-proxy"
"$test_dir/test-terminal-proxy"
