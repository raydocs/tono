#!/bin/sh
# Check unsigned input BEFORE Xcode CodeSignOnCopy changes its bytes.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
binary="$repo/apps/macos/Tono/Resources/sing-box"
echo "ab0187a774e2515e7e6761e23ece0b656818cb4c31c983070b3fd023db172258  $binary" | shasum -a 256 -c -
