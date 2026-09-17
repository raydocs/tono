#!/bin/sh
# Check unsigned input BEFORE Xcode CodeSignOnCopy changes its bytes.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
binary="$repo/apps/macos/Tono/Resources/sing-box"
echo "6c86720c7baf60057ad9ea05b64149939d29a37397e93599563de0db5677baae  $binary" | shasum -a 256 -c -
