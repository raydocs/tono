#!/usr/bin/env bash
# Captures the DEBUG design preview (fixture lines, no account, no tunnel) in an iOS Simulator.
# These are screenshots of the real SwiftUI views; they prove layout and copy, not connectivity.
# usage: apps/ios/tools/preview-screenshots.sh <Tono.app (Debug-iphonesimulator)> <out-dir>
set -euo pipefail
APP="$1"
OUT="$2"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")"
mkdir -p "$OUT"
UDID="$(xcrun simctl list devices available -j | python3 -c '
import json, sys
devices = json.load(sys.stdin)["devices"]
phones = [d for runtime, ds in sorted(devices.items(), reverse=True) if "iOS" in runtime for d in ds if d["name"].startswith("iPhone") and "Pro" in d["name"] and "Max" not in d["name"]]
print(phones[0]["udid"] if phones else "")')"
[[ -n "$UDID" ]] || { echo "no iPhone simulator available" >&2; exit 1; }
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 || true
xcrun simctl install "$UDID" "$APP"
xcrun simctl list devices | grep "$UDID" > "$OUT/device.txt"
shot() { # <name> <lang> <phase> [sheet]
  local name="$1" lang="$2" phase="$3" sheet="${4:-}"
  local args=(-TonoPreview "$phase" -AppleLanguages "($lang)" -AppleLocale "$([[ $lang == zh-Hans ]] && echo zh_CN || echo en_US)")
  [[ -n "$sheet" ]] && args+=(-TonoPreviewSheet "$sheet")
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
  xcrun simctl launch "$UDID" "$BUNDLE_ID" "${args[@]}" >/dev/null
  sleep 4
  xcrun simctl io "$UDID" screenshot --type=png "$OUT/$name.png" >/dev/null
  echo "captured $name"
}
# Warm-up launch: a freshly booted simulator posts its own system banners (e.g. Apple Intelligence)
# in the first minutes; let them come and go before any capture.
xcrun simctl launch "$UDID" "$BUNDLE_ID" -TonoPreview IDLE >/dev/null
sleep 20
# Large text (Dynamic Type accessibility L) and increased contrast, Chinese, the two busiest screens.
xcrun simctl ui "$UDID" content_size accessibility-large
shot "a11y-large-text-connected" zh-Hans CONNECTED
shot "a11y-large-text-signin" zh-Hans SIGNED_OUT
xcrun simctl ui "$UDID" content_size large
xcrun simctl ui "$UDID" increase_contrast enabled || true
shot "a11y-increase-contrast-connected" zh-Hans CONNECTED
xcrun simctl ui "$UDID" increase_contrast disabled || true

# Motion: one recorded walk through the service states (idle → connecting → connected → degraded →
# connected → disconnecting → idle → connecting → failed), Chinese copy.
xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl launch "$UDID" "$BUNDLE_ID" -TonoPreviewCycle -AppleLanguages "(zh-Hans)" -AppleLocale zh_CN >/dev/null
sleep 1
xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$OUT/state-cycle.mp4" &
REC=$!
sleep 32  # one full 23 s loop plus recorder start-up lag
kill -INT "$REC"
wait "$REC" || true
echo "recorded state-cycle.mp4"

for lang in zh-Hans en; do
  shot "$lang-01-signin" "$lang" SIGNED_OUT
  shot "$lang-02-idle" "$lang" IDLE
  shot "$lang-02b-permission" "$lang" NEEDS_PERMISSION
  shot "$lang-03a-preparing" "$lang" PREPARING
  shot "$lang-03-connecting" "$lang" CONNECTING
  shot "$lang-04-connected" "$lang" CONNECTED
  shot "$lang-05-degraded" "$lang" DEGRADED
  shot "$lang-06-failed" "$lang" FAILED
  shot "$lang-07-lines" "$lang" CONNECTED lines
  shot "$lang-08-settings" "$lang" CONNECTED settings
  shot "$lang-09-details" "$lang" DEGRADED details
done
