#!/usr/bin/env bash
# Linux typecheck of the packet tunnel and the app model/services against TonoKit (built as its own
# module, so access control is checked) and the stand-ins in stubs/ for Libbox, NetworkExtension,
# UIKit/SwiftUI pieces. A typecheck only: no iOS SDK, nothing runs. Xcode builds stay on hosted CI.
# Usage: stub-typecheck.sh <out-dir>
set -uo pipefail
OUT="$(mkdir -p "${1:?out dir}" && cd "$1" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(git rev-parse --show-toplevel)"; IOS="$ROOT/apps/ios"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
check() { # name files...
  local name="$1"; shift
  rm -rf "$W/mod" "$W/flat"; mkdir -p "$W/mod" "$W/flat"
  {
    echo "commit: $(git -C "$ROOT" rev-parse HEAD)  ios tree changed files: $(git -C "$ROOT" status --porcelain -- apps/ios | wc -l | tr -d ' ')"
    echo "swift: $(swift --version 2>&1 | head -1)"
    echo "\$ swiftc -emit-module TonoKit"
    swiftc -emit-module -module-name TonoKit -emit-module-path "$W/mod/TonoKit.swiftmodule" -parse-as-library "$IOS"/TonoKit/Sources/TonoKit/*.swift 2>&1
    echo "exit: $?"
    for f in "$@"; do
      # iOS-only blocks are checked too; frameworks Linux lacks come from stubs/.
      src="$IOS/$f"; [[ "$f" = /* ]] && src="$f"
      sed -E "s/^(\s*)#if os\(iOS\)/\1#if true/" "$src" \
        | sed -E '/^import (Libbox|NetworkExtension|Network|os\.log|os|notify|Security|UIKit|SwiftUI|Combine)$/d; s/^import Foundation$/import Foundation\nimport FoundationNetworking/; /waitsForConnectivity = false/d' \
        > "$W/flat/$(basename "$(dirname "$f")")_$(basename "$f")"
    done
    cp "$HERE"/stubs/*.swift "$W/flat/"
    [[ "$name" = packet-tunnel* ]] && rm -f "$W/flat/AppExtra.swift"
    echo "\$ swiftc -typecheck -D DEBUG $*"
    swiftc -typecheck -I "$W/mod" -D DEBUG "$W"/flat/*.swift 2>&1 | sed "s#$W/flat/##"
    echo "exit: ${PIPESTATUS[0]}"
  } > "$OUT/$name.log" 2>&1
}
cd "$IOS"
check packet-tunnel PacketTunnel/PacketTunnelProvider.swift PacketTunnel/TunnelPlatform.swift PacketTunnel/UnderlyingNetwork.swift \
  Shared/NodeLatency.swift Shared/SharedFiles.swift Status/StatusReload.swift Status/StatusStore.swift
check app-model-services $(ls App/Model/*.swift) App/Services/Storage.swift App/Services/TrafficMonitor.swift App/Services/Transport.swift \
  App/Services/TunnelController.swift App/Services/TunnelCommand.swift Shared/NodeLatency.swift Shared/SharedFiles.swift \
  Status/StatusReload.swift Status/StatusStore.swift Status/TunnelIntents.swift
# Negative control: the same check must report an error when the extension calls a TunnelGraph
# member that does not exist (so 0 errors above is not a check that cannot fail).
mkdir -p "$W/neg/PacketTunnel"
sed 's/current.heartbeat(since:/current.heartbeatRemoved(since:/' PacketTunnel/PacketTunnelProvider.swift > "$W/neg/PacketTunnel/PacketTunnelProvider.swift"
check packet-tunnel-negative-control "$W/neg/PacketTunnel/PacketTunnelProvider.swift" PacketTunnel/TunnelPlatform.swift PacketTunnel/UnderlyingNetwork.swift \
  Shared/NodeLatency.swift Shared/SharedFiles.swift Status/StatusReload.swift Status/StatusStore.swift
