#!/bin/zsh
set -uo pipefail

# One entry point, because the alternative was remembering a list. That is not a
# hypothetical failure: `test-isolated-data-plane.sh` sat unrun long enough for
# its own precondition to be forgotten, and the two checks that would have caught
# this session's shipped faults — does pfctl accept the ruleset, does a re-arm
# withdraw a permit the session still needs — are exactly the ones that stay
# silent unless someone thinks to use sudo.
#
# So nothing here is allowed to skip quietly. Every suite reports pass, fail, or
# skipped-with-a-reason, and the summary distinguishes all three. A clean run
# that skipped half its coverage must not look like a clean run.

repo_root=${0:A:h:h:h}
cd "$repo_root"

fixture="$repo_root/tooling/scripts/tests/fixtures/multi-vless-reality.yaml"
helper="$repo_root/apps/macos/Tono/Resources/liquidclash-helper"
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}

typeset -a passed failed skipped

run() {
  local name=$1
  shift
  if "$@" > "/tmp/tono-all-$$.log" 2>&1; then
    passed+=("$name")
    print "  ok       $name"
  else
    failed+=("$name")
    print "  FAILED   $name"
    tail -6 "/tmp/tono-all-$$.log" | sed 's/^/             /'
  fi
  rm -f "/tmp/tono-all-$$.log"
}

skip() {
  skipped+=("$1 — $2")
  print "  skipped  $1 ($2)"
}

print "Tono macOS suite"

run "xctest (app unit tests)" \
  xcodebuild test -project apps/macos/LiquidClash.xcodeproj -scheme LiquidClash \
    -destination 'platform=macOS,arch=arm64' -quiet

run "subscription url policy" tooling/scripts/test-subscription-url-policy.sh
run "helper peer authorization" tooling/scripts/test-helper-peer-authorization.sh
run "multi-exit policy (mihomo validates)" \
  tooling/scripts/test-multi-exit-policy.sh "$fixture"
run "macos incident regressions" tooling/scripts/test-macos-incident-regressions.sh
run "reload preserves connections" tooling/scripts/test-reload-preserves-connections.sh
run "appcast publisher" node --test tooling/scripts/tests/publish-macos-appcast.test.mjs

# Root-only. These cover the two faults that shipped, so a skip is reported
# loudly rather than folded into the pass count.
if [[ $EUID -eq 0 ]]; then
  run "helper self-test (with PF parse)" "$helper" --self-test
  run "helper lifecycle self-test" "$helper" --lifecycle-self-test
  run "helper staging refusal matrix" "$helper" --staging-self-test
else
  skip "helper self-test (with PF parse)" "needs root; re-run with sudo"
  skip "helper lifecycle self-test" "needs root; re-run with sudo"
  skip "helper staging refusal matrix" "needs root; re-run with sudo"
fi

# Needs a real runtime with credentials, and refuses while protection is armed.
if [[ -n ${TONO_TEST_RUNTIME_YAML:-} ]]; then
  run "isolated data plane" \
    tooling/scripts/test-isolated-data-plane.sh "$TONO_TEST_RUNTIME_YAML"
else
  skip "isolated data plane" "set TONO_TEST_RUNTIME_YAML to a real runtime; disconnect first"
fi

print ""
print "passed ${#passed} · failed ${#failed} · skipped ${#skipped}"
if (( ${#skipped} > 0 )); then
  print "not run:"
  for entry in "${skipped[@]}"; do print "  - $entry"; done
fi
if (( ${#failed} > 0 )); then
  print "failed:"
  for entry in "${failed[@]}"; do print "  - $entry"; done
  exit 1
fi
# Deliberately not exit 0 with coverage missing and no indication of it: the
# caller sees the skip list above, and CI runs the root job separately so it
# never relies on this branch.
exit 0
