#!/usr/bin/env bash
# Type-checks iOS sources against scratch stubs on Linux (no Apple SDK). Strips Apple-only imports.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
IOS=/home/user/workspace/repo/apps/ios
OUT="$HERE/flat"; rm -rf "$OUT"; mkdir -p "$OUT"
for f in "$IOS"/TonoKit/Sources/TonoKit/*.swift "$@"; do
  sed -E "s/^(\s*)#if os\(iOS\)/\1#if true/" "$f" | sed -E '/^import (Libbox|NetworkExtension|Network|TonoKit|os\.log|os|notify|Security|UIKit|SwiftUI|Combine)$/d; s/^@testable import TonoKit$//; s/^import Foundation$/import Foundation\nimport FoundationNetworking/; /waitsForConnectivity = false/d' > "$OUT/$(basename "$(dirname "$f")")_$(basename "$f")"
done
cp "$HERE"/stubs/*.swift "$OUT/"
export PATH=/home/user/workspace/repo/.amp/in/tools/swift/usr/bin:$PATH
swiftc -typecheck -D DEBUG -D os_iOS_stub "$OUT"/*.swift 2>&1 | grep -E "error|warning: (variable|initialization|will never)" | sed "s#$OUT/##" | head -80
