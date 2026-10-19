#!/usr/bin/env bash
# Two-module typecheck: TonoKit as its own module (catches access control), app/extension files against it + stubs.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; IOS=/home/user/workspace/repo/apps/ios
export PATH=/home/user/workspace/repo/.amp/in/tools/swift/usr/bin:$PATH
M="$HERE/mod"; rm -rf "$M"; mkdir -p "$M"
swiftc -emit-module -module-name TonoKit -emit-module-path "$M/TonoKit.swiftmodule" -parse-as-library "$IOS"/TonoKit/Sources/TonoKit/*.swift 2>&1 | grep error || true
OUT="$HERE/flat2"; rm -rf "$OUT"; mkdir -p "$OUT"
for f in "$@"; do
  sed -E "s/^(\s*)#if os\(iOS\)/\1#if true/" "$f" | sed -E '/^import (Libbox|NetworkExtension|Network|os\.log|os|notify|Security|UIKit|SwiftUI|Combine)$/d; s/^import Foundation$/import Foundation\nimport FoundationNetworking/; /waitsForConnectivity = false/d' > "$OUT/$(basename "$(dirname "$f")")_$(basename "$f")"
done
cp "$HERE"/stubs/*.swift "$OUT/"
swiftc -typecheck -I "$M" -D DEBUG "$OUT"/*.swift 2>&1 | grep -E "error" | sed "s#$OUT/##" | head -60
