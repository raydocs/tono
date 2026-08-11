#!/bin/sh
# Pre-release gate for the privileged-IPC boundary.
#
# The helper authenticates its client with a code-signing requirement. If a
# shipped build does not satisfy that requirement, the helper answers every
# request with 403 and the app is inert: no tunnel, no kill switch, no way in
# except `tono-core-helper --emergency-reset`. That failure is total and it is
# invisible until someone actually connects, so it is checked here mechanically
# against the built artifact rather than reasoned about from build settings.
#
# The requirement text is extracted from PeerAuthorization.swift, so this gate
# cannot drift from the helper that enforces it.
#
# Usage: tooling/scripts/verify-release-gate.sh /path/to/Tono.app
set -eu

if [ $# -ne 1 ]; then
  echo "usage: $0 /path/to/Tono.app" >&2
  exit 2
fi
app=$1
case $app in
  /*) ;;
  *) app=$(pwd)/$app ;;
esac
if [ ! -d "$app" ]; then
  echo "not an app bundle: $app" >&2
  exit 2
fi

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo_dir=$(CDPATH= cd -- "$repo_dir/.." && pwd)
source_file="$repo_dir/tooling/scripts/helper-shared/PeerAuthorization.swift"
requirement=$(
  grep -o '#"anchor apple generic[^#]*"#' "$source_file" |
    sed 's/^#"//; s/"#$//'
)
if [ -z "$requirement" ]; then
  echo "FAIL: could not extract the client requirement from PeerAuthorization.swift" >&2
  exit 1
fi

failures=0
fail() {
  echo "  FAIL: $1"
  failures=$((failures + 1))
}
pass() {
  echo "  ok:   $1"
}

echo "requirement: $requirement"
echo
echo "$(basename "$app")"

if codesign --verify --deep --strict "$app" >/dev/null 2>&1; then
  pass "signature is valid"
else
  fail "signature is not valid"
fi

if codesign --verify -R="$requirement" "$app" >/dev/null 2>&1; then
  pass "satisfies the helper's client requirement"
else
  fail "does NOT satisfy the helper's client requirement (helper would 403 every request)"
fi

# Hardened runtime carries library validation, which is what stops a same-UID
# process from loading its own code into a build that does satisfy the
# requirement above.
if codesign -dv --verbose=2 "$app" 2>&1 | grep -q "flags=.*runtime"; then
  pass "hardened runtime enabled"
else
  fail "hardened runtime is not enabled"
fi

if codesign -d --entitlements - --xml "$app" 2>/dev/null |
  grep -q "get-task-allow"; then
  fail "carries get-task-allow (debuggable: any same-UID process could drive the privileged socket)"
else
  pass "no get-task-allow"
fi

# The daemon refuses an ad-hoc signed helper, so an unsigned or ad-hoc embedded
# copy fails at install time rather than at run time.
for embedded in Contents/Resources/liquidclash-helper Contents/Resources/mihomo; do
  path="$app/$embedded"
  if [ ! -f "$path" ]; then
    fail "missing embedded executable: $embedded"
    continue
  fi
  authority=$(codesign -dv --verbose=2 "$path" 2>&1 |
    sed -n 's/^Authority=//p' | head -1)
  case $authority in
    "Developer ID Application:"*) pass "$embedded signed by $authority" ;;
    "") fail "$embedded is unsigned or ad-hoc signed" ;;
    *) fail "$embedded has unexpected authority: $authority" ;;
  esac
done

echo
if [ "$failures" -ne 0 ]; then
  echo "release gate FAILED with $failures problem(s)"
  exit 1
fi
echo "release gate passed"
echo
echo "Still requires a live machine — this gate cannot cover them:"
echo "  1. Connect once with this build against an installed helper."
echo "     Proves the requirement holds at runtime (audit token + dynamic"
echo "     validity), not just statically, and that the control-plane PF permit"
echo "     narrowed to 'user { 0, <uid> }' still allows recovery fetches."
echo "  2. With the kill switch armed, request a host that matches only a"
echo "     directSuffixes entry and never an exact webDomains pin, e.g."
echo "     curl -sS -m 10 -o /dev/null -w '%{http_code}' https://i0.hdslb.com/"
echo "     Connects  => suffix routes were reaching egress; re-open the"
echo "                  ConfigPipeline suffix decision before shipping."
echo "     Fails     => confirms suffix routes had no PF permit and the current"
echo "                  fall-through to Tono-Exit is the correct behaviour."
