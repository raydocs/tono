#!/bin/zsh
# Cursor and gzip contract for the test-programme log upload.
#
# Compiles the real DiagnosticsLogUploader source — not a copy — against minimal
# stubs, then drives it over real files in a temporary directory: partial-line
# trimming, cursor advance, an idle sweep, and recovery of the unsent tail after
# a rotation. gunzip verifies each segment, so a broken gzip wrapper fails here
# rather than filling the bucket with unreadable objects.
set -euo pipefail

repo_root=${0:A:h:h:h}
tono_developer_dir=/Applications/Xcode.app/Contents/Developer
test_dir=$(mktemp -d /tmp/tono-log-upload.XXXXXX)
trap 'rm -rf "$test_dir"' EXIT

DEVELOPER_DIR="$tono_developer_dir" /usr/bin/xcrun swiftc \
  -O \
  -module-cache-path "$test_dir/module-cache" \
  "$repo_root/apps/macos/Tono/Services/DiagnosticsLogUploader.swift" \
  "$repo_root/tooling/scripts/tests/DiagnosticsLogUploaderTests.swift" \
  -o "$test_dir/log-upload-tests"

"$test_dir/log-upload-tests"
