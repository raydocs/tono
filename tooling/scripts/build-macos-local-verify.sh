#!/bin/zsh
# Builds a working-tree macOS app that the installed privileged helper will
# actually talk to, so UI changes can be clicked through instead of reviewed by
# reading.
#
# Why a Debug build cannot be used: the helper authorizes its peer against
#
#   anchor apple generic and identifier "com.raydocs.tono"
#     and certificate leaf[subject.OU] = "YY57758GS7"
#     and entitlement["com.apple.security.get-task-allow"] absent
#
# Xcode injects `get-task-allow` into every Debug build — that entitlement is
# what lets a debugger attach — so a Debug build fails the last clause by
# construction. That clause is deliberate and worth keeping: it stops a
# debuggable process from driving a root daemon. The Release configuration sets
# CODE_SIGN_INJECT_BASE_ENTITLEMENTS = NO and uses Tono-Release.entitlements, so
# a Release build signed with the team's Developer ID satisfies all three
# clauses and can use the installed helper.
#
# Usage:
#   tooling/scripts/build-macos-local-verify.sh            # build + verify
#   tooling/scripts/build-macos-local-verify.sh --install  # also replace /Applications/Tono.app
set -euo pipefail

repo_root=${0:A:h:h:h}
derived=${TONO_LOCAL_VERIFY_DERIVED:-/tmp/tono-xcode-release}
identity=${TONO_SIGN_IDENTITY:-"Developer ID Application: Ruirui Wan (YY57758GS7)"}
developer_dir=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}

if [[ ! -d $developer_dir ]]; then
  echo "Xcode not found at $developer_dir. xcode-select may point at the Command Line Tools;" >&2
  echo "this script does not need that changed — it sets DEVELOPER_DIR itself." >&2
  exit 2
fi

if ! security find-identity -v -p codesigning | grep -q "$identity"; then
  echo "signing identity not in the keychain: $identity" >&2
  echo "without it the build cannot satisfy the helper's peer requirement." >&2
  exit 2
fi

DEVELOPER_DIR="$developer_dir" /usr/bin/xcodebuild build \
  -project "$repo_root/apps/macos/LiquidClash.xcodeproj" \
  -scheme LiquidClash \
  -configuration Release \
  -destination 'platform=macOS' \
  -derivedDataPath "$derived" \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="$identity" >/dev/null

app="$derived/Build/Products/Release/Tono.app"
[[ -d $app ]] || { echo "build produced no app at $app" >&2; exit 1 }

# The whole point of the script: fail loudly here rather than at runtime, where
# the symptom is the app hanging on "正在恢复你的 Tono 会话…" with no explanation.
requirement='anchor apple generic and identifier "com.raydocs.tono" and certificate leaf[subject.OU] = "YY57758GS7" and entitlement["com.apple.security.get-task-allow"] absent'
if ! codesign --verify -R="$requirement" "$app" >/dev/null 2>&1; then
  echo "this build does NOT satisfy the helper's peer requirement; it would hang on launch" >&2
  codesign -dv --entitlements - "$app" >&2 || true
  exit 1
fi
echo "built and signed: $app"
echo "satisfies the helper peer requirement"

if [[ ${1:-} == --install ]]; then
  # Replaces the copy the customer-facing app runs from. Deliberately opt-in:
  # the installed copy is also what someone may be relying on right now.
  echo "replacing /Applications/Tono.app"
  osascript -e 'quit app "Tono"' >/dev/null 2>&1 || true
  sleep 2
  rm -rf /Applications/Tono.app
  cp -R "$app" /Applications/Tono.app
  echo "installed. open -a Tono to verify."
else
  echo
  echo "to click through it against the installed helper:"
  echo "  tooling/scripts/build-macos-local-verify.sh --install"
fi
