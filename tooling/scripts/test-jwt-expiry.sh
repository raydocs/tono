#!/bin/zsh
# Access-token expiry parsing, used to renew before a 401 instead of after one.
#
# The parser is extracted from TonoAPIClient at run time rather than copied into
# this directory: a copy would keep passing after the shipped code changed. The
# cases that matter are the quiet ones — base64url padding, and every malformed
# shape returning nil so proactive renewal switches off instead of inventing a
# deadline.
set -euo pipefail

repo_root=${0:A:h:h:h}
tono_developer_dir=/Applications/Xcode.app/Contents/Developer
test_dir=$(mktemp -d /tmp/tono-jwt.XXXXXX)
trap 'rm -rf "$test_dir"' EXIT

/usr/bin/python3 - "$repo_root" "$test_dir" <<'PY'
import sys
repo, out = sys.argv[1], sys.argv[2]
path = f"{repo}/apps/macos/Tono/Services/TonoAPIClient.swift"
src = open(path, encoding="utf-8").read()
marker = "    nonisolated static func expiry(ofJWT token: String) -> Date? {"


def unlocatable(what):
    # A rename or a reindentation moves the marker, and the extraction then has
    # nothing to compile. Say so on stderr and stop non-zero, so the run reads as
    # a failure rather than as coverage.
    sys.stderr.write(
        f"test-jwt-expiry: {what} in TonoAPIClient.swift; "
        "the expiry parser moved and nothing was tested\n"
    )
    raise SystemExit(1)


if marker not in src:
    unlocatable("expiry(ofJWT:) was not found")
start = src.index(marker)
end = src.find("\n    }\n", start)
if end < 0:
    unlocatable("the end of expiry(ofJWT:) was not found")
end += len("\n    }\n")
open(f"{out}/shim.swift", "w", encoding="utf-8").write(
    "import Foundation\n\nenum TonoJWT {\n" + src[start:end] + "}\n"
)
PY

DEVELOPER_DIR="$tono_developer_dir" /usr/bin/xcrun swiftc \
  -O \
  -module-cache-path "$test_dir/module-cache" \
  "$test_dir/shim.swift" \
  "$repo_root/tooling/scripts/tests/JWTExpiryTests.swift" \
  -o "$test_dir/jwt-tests"

"$test_dir/jwt-tests"
