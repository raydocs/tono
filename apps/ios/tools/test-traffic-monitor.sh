#!/bin/bash
# Native compilation belongs on hosted CI/Devin, never the maintainer's MacBook.
set -euo pipefail
IOS="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/tono-traffic-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
cp -R "$IOS/Tests/TrafficMonitorHarness/." "$WORK/"
cp -R "$IOS/TonoKit" "$WORK/TonoKit"
mkdir -p "$WORK/Sources/TrafficMonitor"
cp "$IOS/App/Services/TrafficMonitor.swift" "$WORK/Sources/TrafficMonitor/"
swift test --package-path "$WORK" "$@"
