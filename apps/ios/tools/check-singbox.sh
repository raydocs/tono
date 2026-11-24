#!/usr/bin/env bash
# Host-side proof for the iOS routing graph, no Apple tools needed:
#   1. generates the SampleCatalog configs with TonoKit (`swift run tono-config write`);
#   2. validates each with the pinned upstream sing-box CLI (`sing-box check`);
#   3. runs each through the real kernel with local stand-ins (tools/route-harness.py),
#      including Home-down and cloud-down cases that must fail instead of going DIRECT.
# usage: apps/ios/tools/check-singbox.sh [work-dir]
set -euo pipefail
IOS="$(cd "$(dirname "$0")/.." && pwd)"
source "$IOS/supply-chain/sing-box.pin"
grep -qx "TONO_SING_BOX_VERSION = $SING_BOX_VERSION" "$IOS/Configuration/Base.xcconfig" \
  || { echo "Configuration/Base.xcconfig TONO_SING_BOX_VERSION does not match sing-box.pin ($SING_BOX_VERSION)" >&2; exit 1; }
WORK="${1:-${TONO_SB_WORK:-$HOME/.tono-tools/sing-box-cli}}"
mkdir -p "$WORK"
ARCHIVE="$WORK/$SING_BOX_LINUX_AMD64_ASSET"
[[ -f "$ARCHIVE" ]] || curl --fail --location --retry 3 \
  "https://github.com/SagerNet/sing-box/releases/download/$SING_BOX_TAG/$SING_BOX_LINUX_AMD64_ASSET" -o "$ARCHIVE"
echo "$SING_BOX_LINUX_AMD64_SHA256  $ARCHIVE" | sha256sum --check --status || { echo "sing-box CLI SHA-256 mismatch" >&2; exit 1; }
BIN="$WORK/sing-box-$SING_BOX_VERSION-linux-amd64/sing-box"
[[ -x "$BIN" ]] || tar -xzf "$ARCHIVE" -C "$WORK"
"$BIN" version | head -1
CONFIGS="$WORK/configs"
rm -rf "$CONFIGS"
(cd "$IOS/TonoKit" && swift run -q tono-config write "$CONFIGS")
status=0
for config in "$CONFIGS"/*.json; do
  name="$(basename "$config")"
  if "$BIN" check -c "$config"; then echo "check ok   $name"; else echo "check FAIL $name"; status=1; continue; fi
  if python3 "$IOS/tools/route-harness.py" "$BIN" "$config" > "$WORK/$name.harness.log" 2>&1; then
    echo "route ok   $name ($(grep -c '^ok ' "$WORK/$name.harness.log") expectations)"
  else
    echo "route FAIL $name"; cat "$WORK/$name.harness.log"; status=1
  fi
done
exit $status
