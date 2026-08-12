#!/bin/sh
set -eu

# Build the macOS test artifact through the same Developer ID trust boundary
# used by the privileged helper. An ad-hoc/unsigned app is deliberately not a
# supported test artifact: HelperManager and the installed daemon authenticate
# the Tono Developer ID identity, so such a bundle would only fail on first
# launch with a misleading administrator-repair prompt.

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
developer_dir=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
team_id=YY57758GS7
signing_identity=${TONO_MACOS_SIGNING_IDENTITY:-}
notarize=${TONO_MACOS_NOTARIZE:-0}
notary_profile=${TONO_MACOS_NOTARY_PROFILE:-}

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

if [ ! -x "$developer_dir/usr/bin/xcodebuild" ]; then
    echo "Xcode developer tools not found: $developer_dir" >&2
    exit 1
fi

helper_builder="$repo_root/tooling/scripts/build-core-helper.sh"
if [ -x "$helper_builder" ]; then
    "$helper_builder" >/dev/null
fi

for executable in \
    "$repo_root/apps/macos/Tono/Resources/liquidclash-helper" \
    "$repo_root/apps/macos/Tono/Resources/mihomo"; do
    if [ ! -x "$executable" ]; then
        echo "Missing embedded executable: $executable" >&2
        exit 1
    fi
done

build_root=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/tono-macos-package.XXXXXX")
cleanup() {
    /bin/rm -rf "$build_root"
}
trap cleanup EXIT HUP INT TERM

archive_path="$build_root/Tono.xcarchive"
derived_data_path="$build_root/DerivedData"
artifact_stamp=$(/bin/date -u '+%Y%m%d-%H%M%S')
artifact_dir=${1:-$repo_root/artifacts}
artifact_name=${2:-Tono-macOS-signed-test-$artifact_stamp}
artifact_app="$artifact_dir/$artifact_name.app"
artifact_zip="$artifact_dir/$artifact_name.zip"

/bin/mkdir -p "$artifact_dir"
if [ -e "$artifact_app" ] || [ -e "$artifact_zip" ]; then
    echo "Refusing to overwrite an existing artifact: $artifact_name" >&2
    exit 1
fi

DEVELOPER_DIR="$developer_dir" /usr/bin/xcodebuild \
    -project "$repo_root/apps/macos/LiquidClash.xcodeproj" \
    -scheme LiquidClash \
    -configuration Release \
    -derivedDataPath "$derived_data_path" \
    -archivePath "$archive_path" \
    -destination 'generic/platform=macOS' \
    ARCHS=arm64 \
    ONLY_ACTIVE_ARCH=NO \
    CODE_SIGN_STYLE=Manual \
    CODE_SIGN_IDENTITY="$signing_identity" \
    DEVELOPMENT_TEAM="$team_id" \
    CODE_SIGNING_ALLOWED=YES \
    CODE_SIGNING_REQUIRED=YES \
    archive >/dev/null

source_app="$archive_path/Products/Applications/Tono.app"
if [ ! -d "$source_app" ]; then
    echo "Xcode archive did not contain Tono.app" >&2
    exit 1
fi

# Xcode signs Sparkle.framework's main binary but leaves its nested helpers
# ad-hoc and without a secure timestamp, which Apple's notary service rejects
# outright (16 errors, all of them these four paths). Re-sign innermost-first,
# then re-seal the framework and the app. Entitlements are deliberately not
# preserved: Autoupdate ships Sparkle's own com.apple.application-identifier,
# which does not belong to this team and is not needed for Developer ID.
sparkle_versioned="$source_app/Contents/Frameworks/Sparkle.framework/Versions/B"
if [ -d "$sparkle_versioned" ]; then
    for nested in \
        "$sparkle_versioned/XPCServices/Installer.xpc" \
        "$sparkle_versioned/XPCServices/Downloader.xpc" \
        "$sparkle_versioned/Updater.app" \
        "$sparkle_versioned/Autoupdate" \
        "$source_app/Contents/Frameworks/Sparkle.framework"; do
        [ -e "$nested" ] || continue
        /usr/bin/codesign --force --options runtime --timestamp \
            --sign "$signing_identity" "$nested" >/dev/null
    done
    /usr/bin/codesign --force --options runtime --timestamp \
        --sign "$signing_identity" "$source_app" >/dev/null

    # A remaining ad-hoc signature anywhere under Sparkle means the notary
    # submission would fail minutes later; fail here with the path instead.
    for nested in \
        "$sparkle_versioned/XPCServices/Installer.xpc" \
        "$sparkle_versioned/XPCServices/Downloader.xpc" \
        "$sparkle_versioned/Updater.app" \
        "$sparkle_versioned/Autoupdate" \
        "$sparkle_versioned/Sparkle"; do
        [ -e "$nested" ] || continue
        if /usr/bin/codesign --display --verbose=2 "$nested" 2>&1 \
            | /usr/bin/grep -qF adhoc; then
            echo "Sparkle component is still ad-hoc signed: $nested" >&2
            exit 1
        fi
    done
fi

verify_signed_executable() {
    executable=$1
    metadata=$(/usr/bin/codesign --display --verbose=2 "$executable" 2>&1)
    printf '%s\n' "$metadata" | /usr/bin/grep -F "TeamIdentifier=$team_id" >/dev/null
}

# HelperManager.verifyEmbeddedExecutable pins the signing identifier as well as
# the team, and CodeSignOnCopy has been observed deriving the identifier from the
# filename instead of preserving it. That produced shipped builds whose embedded
# helper read `liquidclash-helper`, so every administrator repair failed with a
# misleading "not signed with the Tono Developer ID identity" and the app sat in
# Protected Offline. Fail the build here instead of at a user's first launch.
verify_embedded_requirement() {
    executable=$1
    expected_identifier=$2
    if ! /usr/bin/codesign --verify -R \
        "=anchor apple generic and identifier \"$expected_identifier\" and certificate leaf[subject.OU] = \"$team_id\"" \
        "$executable" >/dev/null 2>&1; then
        echo "Embedded executable does not satisfy the runtime requirement Tono enforces:" >&2
        echo "  $executable" >&2
        echo "  expected identifier: $expected_identifier" >&2
        echo "  actual: $(/usr/bin/codesign --display --verbose=2 "$executable" 2>&1 | /usr/bin/grep -E '^Identifier=' || echo 'unknown')" >&2
        exit 1
    fi
}

/usr/bin/codesign --verify --deep --strict --all-architectures "$source_app"
verify_signed_executable "$source_app/Contents/MacOS/Tono"
verify_signed_executable "$source_app/Contents/Resources/liquidclash-helper"
verify_signed_executable "$source_app/Contents/Resources/mihomo"
verify_embedded_requirement \
    "$source_app/Contents/Resources/liquidclash-helper" com.raydocs.tono.helper
verify_embedded_requirement "$source_app/Contents/Resources/mihomo" mihomo

/usr/bin/ditto "$source_app" "$artifact_app"
/usr/bin/codesign --verify --deep --strict --all-architectures "$artifact_app"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$artifact_app" "$artifact_zip"
/usr/bin/unzip -tq "$artifact_zip"

if [ "$notarize" = 1 ]; then
    if [ -z "$notary_profile" ]; then
        echo "TONO_MACOS_NOTARY_PROFILE is required when TONO_MACOS_NOTARIZE=1." >&2
        exit 1
    fi
    DEVELOPER_DIR="$developer_dir" /usr/bin/xcrun notarytool submit \
        "$artifact_zip" \
        --keychain-profile "$notary_profile" \
        --wait \
        --output-format json > "$build_root/notary-result.json"
    DEVELOPER_DIR="$developer_dir" /usr/bin/xcrun stapler staple "$artifact_app" >/dev/null
    DEVELOPER_DIR="$developer_dir" /usr/bin/xcrun stapler validate "$artifact_app"
    /usr/sbin/spctl -a -t exec -vv "$artifact_app"
    /bin/rm -f "$artifact_zip"
    /usr/bin/ditto -c -k --sequesterRsrc --keepParent "$artifact_app" "$artifact_zip"
    /usr/bin/unzip -tq "$artifact_zip"
else
    echo "WARNING: artifact is Developer ID signed but not notarized; do not distribute it outside this Mac." >&2
fi

/usr/bin/codesign --verify --deep --strict --all-architectures "$artifact_app"

echo "Signed app: $artifact_app"
echo "ZIP: $artifact_zip"
/usr/bin/shasum -a 256 "$artifact_zip"
