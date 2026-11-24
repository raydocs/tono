#!/bin/sh
# Check unsigned input BEFORE Xcode CodeSignOnCopy changes its bytes.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
binary="$repo/apps/macos/Tono/Resources/sing-box"
echo "647fb45b72a32b1cd324665010baf5141dedb347b4dedc66e61fce73e5076dce  $binary" | shasum -a 256 -c -
