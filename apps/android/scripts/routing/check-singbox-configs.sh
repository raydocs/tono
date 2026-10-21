#!/usr/bin/env bash
# Validates generated Android configs with the upstream sing-box CLI of the pinned alpha.
# usage: scripts/routing/check-singbox-configs.sh <config-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/supply-chain/sing-box/sing-box.pin"
DIR="${1:?config dir}"
WORK="${TONO_SB_WORK:-$HOME/.tono-tools/sing-box-build}"
mkdir -p "$WORK/cli"
ARCHIVE="$WORK/cli/$SING_BOX_LINUX_AMD64_ASSET"
[[ -f "$ARCHIVE" ]] || curl --fail --location --retry 3 \
  "https://github.com/SagerNet/sing-box/releases/download/$SING_BOX_TAG/$SING_BOX_LINUX_AMD64_ASSET" -o "$ARCHIVE"
echo "$SING_BOX_LINUX_AMD64_SHA256  $ARCHIVE" | sha256sum --check --status || { echo "sing-box CLI SHA-256 mismatch" >&2; exit 1; }
BIN="$WORK/cli/sing-box-$SING_BOX_VERSION-linux-amd64/sing-box"
[[ -x "$BIN" ]] || tar -xzf "$ARCHIVE" -C "$WORK/cli"
"$BIN" version | head -1
status=0
for config in "$DIR"/*.json; do
  # The CLI has no Android platform interface; check validates the schema and rule graph only.
  if "$BIN" check -c "$config"; then echo "ok   $(basename "$config")"; else echo "FAIL $(basename "$config")"; status=1; fi
done
exit $status
