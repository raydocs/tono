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
# Evidence that the built app is installed on this simulator (container path + bundle version).
{ echo "bundle: $BUNDLE_ID"
  echo "container: $(xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" app)"
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' -c 'Print :CFBundleVersion' "$APP/Info.plist"
} > "$OUT/install.txt"
shot() { # <name> <lang> <phase> [sheet] [extra launch args...]
  local name="$1" lang="$2" phase="$3" sheet="${4:-}"
  shift 4 2>/dev/null || shift $#
  local args=(-TonoPreview "$phase" -AppleLanguages "($lang)" -AppleLocale "$([[ $lang == zh-Hans ]] && echo zh_CN || echo en_US)")
  [[ -n "$sheet" ]] && args+=(-TonoPreviewSheet "$sheet")
  args+=("$@")
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
  echo "$name: $(xcrun simctl launch "$UDID" "$BUNDLE_ID" "${args[@]}")" >> "$OUT/launches.txt"   # "<bundle>: <pid>"
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
shot "a11y-large-text-details" zh-Hans DEGRADED details
xcrun simctl ui "$UDID" content_size large
xcrun simctl ui "$UDID" increase_contrast enabled || true
shot "a11y-increase-contrast-connected" zh-Hans CONNECTED
xcrun simctl ui "$UDID" increase_contrast disabled || true
# Reduce Transparency (simctl cannot toggle it; the DEBUG flag feeds the same code path as the setting).
shot "a11y-reduce-transparency-connected" zh-Hans CONNECTED "" -TonoReduceTransparency
shot "a11y-reduce-transparency-details" zh-Hans DEGRADED details -TonoReduceTransparency

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

record() { # <file> <seconds> <launch args...>
  local file="$1" seconds="$2"; shift 2
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
  echo "$file: $(xcrun simctl launch "$UDID" "$BUNDLE_ID" "$@")" >> "$OUT/launches.txt"
  sleep 1
  xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$OUT/$file" &
  local rec=$!
  sleep "$seconds"
  kill -INT "$rec"
  wait "$rec" || true
  echo "recorded $file"
}
# Motion: the service states the way a session moves through them (idle → preparing → connecting →
# connected → degraded → connected → disconnecting → idle → connecting → failed, 23 s loop), then
# the same loop under Reduce Motion (cross-fades only, still sea, no fill sweep or shake).
record state-cycle.mp4 32 -TonoPreviewCycle -AppleLanguages "(zh-Hans)" -AppleLocale zh_CN
record state-cycle-reduce-motion.mp4 28 -TonoPreviewCycle -TonoReduceMotion -AppleLanguages "(zh-Hans)" -AppleLocale zh_CN

# Cost of the live sea on the runner's simulator (host CPU %, RSS KB of the app process; a Mac
# simulator, not an iPhone: only the relative difference means anything).
sample() { # <label> <launch args...>
  local label="$1"; shift
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
  local pid; pid="$(xcrun simctl launch "$UDID" "$BUNDLE_ID" "$@" | awk '{print $NF}')"
  sleep 6
  for _ in 1 2 3 4 5; do echo "$label pid=$pid $(ps -o %cpu=,rss= -p "$pid")"; sleep 1; done >> "$OUT/perf.txt"
}
sample connected-live -TonoPreview CONNECTED
sample connected-reduce-motion -TonoPreview CONNECTED -TonoReduceMotion
sample idle-live -TonoPreview IDLE
xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
cat > "$OUT/README.txt" <<EOF
Tono iOS design preview, captured by apps/ios/tools/preview-screenshots.sh on a GitHub-hosted runner.
Commit: ${GITHUB_SHA:-local}  Run: ${GITHUB_RUN_ID:-local}
The Debug simulator build of Tono.app was installed (install.txt) and launched once per capture
(launches.txt: bundle id and process id) on the simulator in device.txt.
Every screen runs with -TonoPreview: fixture lines and probe results, NO account, NO tunnel, no
network. The yellow badge on each capture says so. -TonoReduceMotion / -TonoReduceTransparency
feed the same code path as the iOS settings (simctl cannot toggle them). perf.txt is host CPU/RSS
of the simulator process on a Mac runner, not iPhone performance. These images show layout, copy and motion only;
they are not evidence of sign-in, connectivity or routing.
EOF
