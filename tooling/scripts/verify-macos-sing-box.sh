#!/bin/sh
# Check unsigned input BEFORE Xcode CodeSignOnCopy changes its bytes.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
binary="$repo/apps/macos/Tono/Resources/sing-box"
echo "a4e886fde02f76f2c7ed12d1d00bb6fe50346475e73a1d1a815952279319f3f5  $binary" | shasum -a 256 -c -
