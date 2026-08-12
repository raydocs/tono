#!/bin/sh
set -eu

# Wrap an already built and signed Tono.app in a Developer ID signed disk image
# so a first-time user gets the "drag to Applications" affordance instead of a
# loose bundle. This is a correctness requirement, not a cosmetic one: release
# builds refuse to start the runtime and never arm Sparkle unless the bundle
# lives in /Applications, so a bundle launched from ~/Downloads silently never
# receives updates. Gatekeeper only trusts a distributed image when the image
# itself is notarized and stapled, so notarization here targets the DMG.

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
developer_dir=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
team_id=YY57758GS7
signing_identity=${TONO_MACOS_SIGNING_IDENTITY:-}
notarize=${TONO_MACOS_NOTARIZE:-0}
notary_profile=${TONO_MACOS_NOTARY_PROFILE:-}
volume_name=${TONO_MACOS_DMG_VOLUME_NAME:-Tono}

if [ "$#" -lt 1 ]; then
    echo "Usage: $0 <signed-Tono.app> [artifact-dir] [artifact-name]" >&2
    echo "The app must already be Developer ID signed, e.g. by package-macos-test.sh." >&2
    exit 1
fi

if [ -z "$signing_identity" ]; then
    signing_identity=$(
        /usr/bin/security find-identity -v -p codesigning 2>/dev/null \
            | /usr/bin/awk -F '"' '/Developer ID Application:/ { print $2; exit }'
    )
fi

case "$signing_identity" in
    "Developer ID Application:"*) ;;
    *)
        echo "A Developer ID Application identity is required." >&2
        echo "Set TONO_MACOS_SIGNING_IDENTITY or install the team's signing certificate." >&2
        exit 1
        ;;
esac

if ! /usr/bin/security find-identity -v -p codesigning 2>/dev/null \
    | /usr/bin/grep -F "\"$signing_identity\"" >/dev/null; then
    echo "The requested signing identity is not available: $signing_identity" >&2
    exit 1
fi

if [ "$notarize" = 1 ]; then
    if [ -z "$notary_profile" ]; then
        echo "TONO_MACOS_NOTARY_PROFILE is required when TONO_MACOS_NOTARIZE=1." >&2
        exit 1
    fi
    for notary_tool in \
        "$developer_dir/usr/bin/notarytool" \
        "$developer_dir/usr/bin/stapler"; do
        if [ ! -x "$notary_tool" ]; then
            echo "Xcode developer tools not found: $developer_dir" >&2
            echo "Set DEVELOPER_DIR to an Xcode that provides notarytool and stapler." >&2
            exit 1
        fi
    done
fi

source_app=$1
if [ ! -d "$source_app" ]; then
    echo "Signed app bundle not found: $source_app" >&2
    exit 1
fi
source_app=$(CDPATH= cd -- "$source_app" && pwd)

case "$source_app" in
    *.app) ;;
    *)
        echo "Expected an .app bundle: $source_app" >&2
        exit 1
        ;;
esac

for executable in \
    "$source_app/Contents/MacOS/Tono" \
    "$source_app/Contents/Resources/liquidclash-helper" \
    "$source_app/Contents/Resources/mihomo"; do
    if [ ! -x "$executable" ]; then
        echo "Missing embedded executable: $executable" >&2
        exit 1
    fi
done

verify_team_identifier() {
    signed_path=$1
    metadata=$(/usr/bin/codesign --display --verbose=2 "$signed_path" 2>&1)
    if ! printf '%s\n' "$metadata" | /usr/bin/grep -F "TeamIdentifier=$team_id" >/dev/null; then
        echo "Signature is not from team $team_id: $signed_path" >&2
        return 1
    fi
}

verify_app_trust_boundary() {
    app_path=$1
    /usr/bin/codesign --verify --deep --strict --all-architectures "$app_path"
    verify_team_identifier "$app_path/Contents/MacOS/Tono"
    verify_team_identifier "$app_path/Contents/Resources/liquidclash-helper"
    verify_team_identifier "$app_path/Contents/Resources/mihomo"
}

artifact_stamp=$(/bin/date -u '+%Y%m%d-%H%M%S')
artifact_dir=${2:-$repo_root/artifacts}
artifact_name=${3:-Tono-macOS-installer-$artifact_stamp}
artifact_dmg="$artifact_dir/$artifact_name.dmg"

/bin/mkdir -p "$artifact_dir"
if [ -e "$artifact_dmg" ]; then
    echo "Refusing to overwrite an existing artifact: $artifact_dmg" >&2
    exit 1
fi

verify_app_trust_boundary "$source_app"

build_root=$(CDPATH= cd -- "$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/tono-macos-dmg.XXXXXX")" && pwd -P)
mount_point="$build_root/mnt"
artifact_created=0
artifact_verified=0
cleanup_done=0

# A non-empty mount point means the image is still attached, including when a
# signal killed the script between attach and the verification steps.
detach_image() {
    if [ ! -d "$mount_point" ] || [ -z "$(/bin/ls -A "$mount_point" 2>/dev/null)" ]; then
        return 0
    fi
    attempt=1
    while [ "$attempt" -le 5 ]; do
        if /usr/bin/hdiutil detach "$mount_point" -quiet 2>/dev/null; then
            return 0
        fi
        /bin/sleep 1
        attempt=$((attempt + 1))
    done
    if /usr/bin/hdiutil detach "$mount_point" -force -quiet 2>/dev/null; then
        return 0
    fi
    echo "WARNING: failed to detach the verification mount: $mount_point" >&2
    return 1
}

cleanup() {
    if [ "$cleanup_done" = 1 ]; then
        return 0
    fi
    cleanup_done=1
    detach_image || true
    if [ "$artifact_created" = 1 ] && [ "$artifact_verified" = 0 ] && [ -f "$artifact_dmg" ]; then
        if /bin/mv -f "$artifact_dmg" "$artifact_dmg.rejected" 2>/dev/null; then
            echo "WARNING: post-packaging verification did not pass; the image was set aside" >&2
            echo "WARNING: as $artifact_dmg.rejected and must not be distributed." >&2
        fi
    fi
    /bin/rm -rf "$build_root" || true
}
# A signal handler must not fall through into the rest of the script: the
# staging directory it needs is already gone once cleanup has run.
trap cleanup EXIT
trap 'cleanup; exit 129' HUP
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

stage_dir="$build_root/stage"
staged_dmg="$build_root/staged.dmg"

/bin/mkdir -p "$stage_dir"
/usr/bin/ditto "$source_app" "$stage_dir/Tono.app"
/bin/ln -s /Applications "$stage_dir/Applications"
verify_app_trust_boundary "$stage_dir/Tono.app"

/usr/bin/hdiutil create \
    -srcfolder "$stage_dir" \
    -volname "$volume_name" \
    -fs HFS+ \
    -format UDZO \
    -imagekey zlib-level=9 \
    -nospotlight \
    -quiet \
    "$staged_dmg"

/usr/bin/codesign --force --timestamp --sign "$signing_identity" "$staged_dmg"
/usr/bin/codesign --verify --strict --verbose=2 "$staged_dmg"
verify_team_identifier "$staged_dmg"

/bin/mv "$staged_dmg" "$artifact_dmg"
artifact_created=1

if [ "$notarize" = 1 ]; then
    DEVELOPER_DIR="$developer_dir" /usr/bin/xcrun notarytool submit \
        "$artifact_dmg" \
        --keychain-profile "$notary_profile" \
        --wait \
        --output-format json > "$build_root/notary-result.json"
    DEVELOPER_DIR="$developer_dir" /usr/bin/xcrun stapler staple "$artifact_dmg" >/dev/null
    DEVELOPER_DIR="$developer_dir" /usr/bin/xcrun stapler validate "$artifact_dmg"
    /usr/sbin/spctl -a -t open --context context:primary-signature -vv "$artifact_dmg"
    notarization_status="notarized and stapled"
else
    echo "WARNING: image is Developer ID signed but not notarized; do not distribute it outside this Mac." >&2
    notarization_status="NOT notarized"
fi

/bin/mkdir -p "$mount_point"
/usr/bin/hdiutil attach "$artifact_dmg" \
    -readonly \
    -nobrowse \
    -noautoopen \
    -noverify \
    -mountpoint "$mount_point" \
    -quiet

mounted_app="$mount_point/Tono.app"
if [ ! -d "$mounted_app" ]; then
    echo "Packaged image does not contain Tono.app" >&2
    exit 1
fi
if [ ! -L "$mount_point/Applications" ] \
    || [ "$(/usr/bin/readlink "$mount_point/Applications")" != /Applications ]; then
    echo "Packaged image is missing the /Applications drop target" >&2
    exit 1
fi

verify_app_trust_boundary "$mounted_app"

if [ "$notarize" = 1 ]; then
    /usr/sbin/spctl -a -t exec -vv "$mounted_app"
fi

detach_image
artifact_verified=1

dmg_size=$(/usr/bin/du -h "$artifact_dmg" | /usr/bin/awk '{ print $1 }')

echo "DMG: $artifact_dmg"
echo "Size: $dmg_size"
echo "Volume name: $volume_name"
echo "Source app: $source_app"
echo "Signing identity: $signing_identity"
echo "Team identifier: $team_id"
echo "Notarization: $notarization_status"
/usr/bin/shasum -a 256 "$artifact_dmg"

if [ "$notarize" != 1 ]; then
    echo "" >&2
    echo "WARNING: $artifact_dmg is NOT notarized." >&2
    echo "WARNING: Gatekeeper will refuse it on any other Mac. Re-run with" >&2
    echo "WARNING: TONO_MACOS_NOTARIZE=1 and TONO_MACOS_NOTARY_PROFILE=<profile> before shipping." >&2
fi
