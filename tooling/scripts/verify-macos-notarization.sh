#!/bin/sh
# Refuse a macOS release artifact whose Tono.app carries no stapled notarization
# ticket or that Gatekeeper does not accept.
#
#   verify-macos-notarization.sh <Tono.app | release.zip>
#
# For a zip the check runs on the Tono.app extracted from it: the bytes customers
# and Sparkle download, not the working copy that was stapled before re-zipping.
# Exits non-zero when the ticket is missing or invalid, when Gatekeeper rejects
# the app, or when the bundle is not a real Tono.app directory (absent, or a
# symlink that would point the check at bytes outside the archive).
#
# Tools are /usr/bin/ditto, /usr/bin/xcrun and /usr/sbin/spctl. TEST ONLY:
# TONO_NOTARIZATION_TOOLS_DIR, when non-empty, names a directory holding stub
# ditto/xcrun/spctl (tooling/scripts/tests/test_verify_macos_notarization.py).
# package-macos-test.sh and release-macos.sh clear it when they call this script.
# Packaging hosts only (hosted macos-26 CI, the release Mac).
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <Tono.app | release.zip>" >&2
  exit 64
fi
artifact=$1
if [ -n "${TONO_NOTARIZATION_TOOLS_DIR-}" ]; then
  echo "WARNING: TONO_NOTARIZATION_TOOLS_DIR is set; test stubs replace the Apple tools" >&2
  ditto=$TONO_NOTARIZATION_TOOLS_DIR/ditto
  xcrun=$TONO_NOTARIZATION_TOOLS_DIR/xcrun
  spctl=$TONO_NOTARIZATION_TOOLS_DIR/spctl
else
  ditto=/usr/bin/ditto
  xcrun=/usr/bin/xcrun
  spctl=/usr/sbin/spctl
fi
work=
cleanup() {
  if [ -n "$work" ]; then rm -rf "$work"; fi
}
trap cleanup EXIT

case "$artifact" in
  *.zip)
    if [ -L "$artifact" ] || [ ! -f "$artifact" ]; then
      echo "FATAL: $artifact is not a regular file" >&2
      exit 1
    fi
    work=$(mktemp -d "${TMPDIR:-/tmp}/tono-notarization.XXXXXX")
    "$ditto" -x -k "$artifact" "$work"
    app="$work/Tono.app"
    ;;
  *.app)
    app=${artifact%/}
    ;;
  *)
    echo "FATAL: $artifact is neither a .app bundle nor a .zip archive" >&2
    exit 1
    ;;
esac
if [ -L "$app" ] || [ -L "$app/Contents" ]; then
  echo "FATAL: Tono.app in $artifact is a symlink; refusing to check bytes outside it" >&2
  exit 1
fi
if [ ! -d "$app/Contents" ]; then
  echo "FATAL: $artifact does not hold a Tono.app bundle" >&2
  exit 1
fi

if ! "$xcrun" stapler validate "$app"; then
  echo "FATAL: $artifact has no valid stapled notarization ticket; never ship it." >&2
  exit 1
fi
if ! "$spctl" -a -t exec -vv "$app"; then
  echo "FATAL: Gatekeeper does not accept the app in $artifact; never ship it." >&2
  exit 1
fi
echo "notarization ticket stapled and Gatekeeper accepts: $artifact"
