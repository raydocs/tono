#!/usr/bin/env bash
# Wraps an accepted, notarized release zip in the customer disk image.
#
#   make-macos-dmg.sh <accepted.zip> <expected-zip-sha256> <out-dir>
#
# Customers who got the zip double-clicked Tono.app in Downloads; Tono runs only
# from /Applications, so it stopped at an alert. The disk image opens to a window
# that says to drag Tono onto Applications. It changes no app bytes: the image
# holds the zip's Tono.app as extracted, and this script refuses to finish unless
# the mounted copy matches the zip file for file. The zip stays the Sparkle
# enclosure and the candidate identity; the image is a second container for it.
#
# With TONO_MACOS_SIGNING_IDENTITY and TONO_MACOS_NOTARY_PROFILE set (the release
# keychain, as in macos-release.yml), the image is signed, notarized and stapled.
# Without them it stops after the layout and the byte proof (a dry run).
#
# Packaging: hosted macos-26 CI only (macos-dmg.yml), never the MacBook.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <accepted.zip> <expected-zip-sha256> <out-dir>" >&2
  exit 64
fi
zip_path=$1
expected_sha=$2
out_dir=$3
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
packaging="$repo_root/apps/macos/packaging/dmg"

actual_sha=$(shasum -a 256 "$zip_path" | awk '{print $1}')
if [ "$actual_sha" != "$expected_sha" ]; then
  echo "FATAL: $zip_path is $actual_sha, not the accepted $expected_sha" >&2
  exit 1
fi

base=$(basename "$zip_path" .zip)
case "$base" in
  Tono-*-build*-arm64) ;;
  *) echo "FATAL: $base is not a Tono-<version>-build<n>-arm64 release name" >&2; exit 1 ;;
esac
mkdir -p "$out_dir"
dmg="$out_dir/$base.dmg"
work=$(mktemp -d)
mount_point="$work/mount"
cleanup() {
  if [ -d "$mount_point" ]; then hdiutil detach -quiet "$mount_point" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

/usr/bin/ditto -x -k "$zip_path" "$work/extracted"
app="$work/extracted/Tono.app"
if [ ! -d "$app" ]; then
  echo "FATAL: $zip_path does not hold Tono.app at its root" >&2
  exit 1
fi
/usr/bin/codesign --verify --deep --strict --all-architectures "$app"
/usr/bin/xcrun stapler validate "$app"
/usr/sbin/spctl -a -t exec -vv "$app"

python3 -m venv "$work/venv"
"$work/venv/bin/pip" install --quiet --disable-pip-version-check --no-deps \
  --only-binary :all: --require-hashes -r "$packaging/requirements.txt"
rm -f "$dmg"
"$work/venv/bin/dmgbuild" -s "$packaging/settings.py" \
  -D app="$app" -D background="$packaging/background.tiff" \
  Tono "$dmg"

# One line per path: type, mode and content digest (or link target).
manifest() {
  (cd "$1" && find Tono.app -print0 | LC_ALL=C sort -z | while IFS= read -r -d '' path; do
    if [ -L "$path" ]; then
      printf 'l %s %s -> %s\n' "$(stat -f %Lp "$path")" "$path" "$(readlink "$path")"
    elif [ -d "$path" ]; then
      printf 'd %s %s\n' "$(stat -f %Lp "$path")" "$path"
    else
      printf 'f %s %s %s\n' "$(stat -f %Lp "$path")" "$path" "$(shasum -a 256 "$path" | awk '{print $1}')"
    fi
  done)
}

prove_contents() {
  mkdir -p "$mount_point"
  hdiutil attach -quiet -nobrowse -readonly -noautoopen -mountpoint "$mount_point" "$dmg"
  # Files, not process substitution: a manifest that fails must fail the proof.
  manifest "$work/extracted" > "$work/expected.manifest"
  manifest "$mount_point" > "$work/actual.manifest"
  if ! grep -q '^f [0-7]* Tono.app/Contents/MacOS/Tono ' "$work/expected.manifest"; then
    echo "FATAL: the accepted app manifest is incomplete" >&2
    exit 1
  fi
  if ! diff "$work/expected.manifest" "$work/actual.manifest" > "$work/manifest.diff"; then
    cat "$work/manifest.diff" >&2
    echo "FATAL: the Tono.app in $dmg is not the accepted zip's Tono.app" >&2
    exit 1
  fi
  if [ "$(readlink "$mount_point/Applications")" != /Applications ]; then
    echo "FATAL: $dmg has no Applications link" >&2
    exit 1
  fi
  /usr/bin/codesign --verify --deep --strict --all-architectures "$mount_point/Tono.app"
  /usr/bin/xcrun stapler validate "$mount_point/Tono.app"
  hdiutil detach -quiet "$mount_point"
  rmdir "$mount_point"
}

prove_contents
echo "app tree in $dmg matches $base.zip ($(wc -l < "$work/expected.manifest" | tr -d ' ') paths)"

if [ -z "${TONO_MACOS_SIGNING_IDENTITY-}" ] || [ -z "${TONO_MACOS_NOTARY_PROFILE-}" ]; then
  # Never leave an unsigned image under the name customers download.
  mv "$dmg" "$out_dir/$base-unsigned.dmg"
  echo "unsigned dry run: $out_dir/$base-unsigned.dmg (no signing identity or notary profile)"
  exit 0
fi

/usr/bin/codesign --force --sign "$TONO_MACOS_SIGNING_IDENTITY" --timestamp "$dmg"
/usr/bin/xcrun notarytool submit "$dmg" --keychain-profile "$TONO_MACOS_NOTARY_PROFILE" --wait \
  --output-format json > "$out_dir/$base.dmg-notary.json"
if ! grep -q '"status" *: *"Accepted"' "$out_dir/$base.dmg-notary.json"; then
  cat "$out_dir/$base.dmg-notary.json" >&2
  echo "FATAL: notarization did not accept $dmg" >&2
  exit 1
fi
/usr/bin/xcrun stapler staple "$dmg"
/usr/bin/xcrun stapler validate "$dmg"
/usr/bin/codesign --verify --strict "$dmg"
/usr/sbin/spctl -a -t open --context context:primary-signature -vv "$dmg"
# Stapling rewrote the image; prove the app inside is still the accepted one.
prove_contents
shasum -a 256 "$dmg" | tee "$out_dir/$base.dmg.sha256"
