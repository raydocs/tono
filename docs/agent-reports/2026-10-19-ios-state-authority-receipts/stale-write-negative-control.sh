#!/usr/bin/env bash
# Negative control: remove only the pre-side-effect reply gate, in a private temporary package.
# Never modifies the checkout. Nonzero XCTest assertion failure is the expected result.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/tono-ios-stale-write.XXXXXX")"
cp "$ROOT/apps/ios/TonoKit/Package.swift" "$WORK/"
cp -R "$ROOT/apps/ios/TonoKit/Sources" "$ROOT/apps/ios/TonoKit/Tests" "$WORK/"
python3 - "$WORK/Sources/TonoKit/RouteApply.swift" <<'PY'
import sys
p=sys.argv[1]
s=open(p).read()
needle='guard acceptReply(answer) else { return RouteApplyReport(.unconfirmed(requested), answer: answer) }'
assert s.count(needle)==2
s=s.replace(needle, '// Negative control: obsolete reply was allowed to perform put-back.')
open(p,'w').write(s)
PY
swift test --package-path "$WORK" --filter testAReplyAfterTheSessionEndedCannotPutOldInputsBack
