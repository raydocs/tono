#!/bin/sh
# Refuse a macOS release artifact whose Tono.app carries no stapled notarization
# ticket or that Gatekeeper does not accept.
#
#   verify-macos-notarization.sh <Tono.app | release.zip>
#
# For a zip the check runs on the Tono.app extracted from it: the bytes customers
# and Sparkle download, not the working copy that was stapled before re-zipping.
# Exits non-zero when the ticket is missing or invalid, when Gatekeeper rejects
# the app, or when the zip does not hold Tono.app at its root.
#
# xcrun, spctl and ditto resolve through PATH (/usr/bin, /usr/sbin on macOS) so
# tooling/scripts/tests/test_verify_macos_notarization.py can stub them.
# Packaging hosts only (hosted macos-26 CI, the release Mac).
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <Tono.app | release.zip>" >&2
  exit 64
fi
artifact=$1
work=
cleanup() {
  if [ -n "$work" ]; then rm -rf "$work"; fi
}
trap cleanup EXIT

case "$artifact" in
  *.zip)
    [ -f "$artifact" ] || { echo "FATAL: $artifact is not a file" >&2; exit 1; }
    work=$(mktemp -d "${TMPDIR:-/tmp}/tono-notarization.XXXXXX")
    ditto -x -k "$artifact" "$work"
    app="$work/Tono.app"
    ;;
  *.app)
    app=$artifact
    ;;
  *)
    echo "FATAL: $artifact is neither a .app bundle nor a .zip archive" >&2
    exit 1
    ;;
esac
if [ ! -d "$app" ]; then
  echo "FATAL: $artifact does not hold Tono.app" >&2
  exit 1
fi

if ! xcrun stapler validate "$app"; then
  echo "FATAL: $artifact has no valid stapled notarization ticket; never ship it." >&2
  exit 1
fi
if ! spctl -a -t exec -vv "$app"; then
  echo "FATAL: Gatekeeper does not accept the app in $artifact; never ship it." >&2
  exit 1
fi
echo "notarization ticket stapled and Gatekeeper accepts: $artifact"
