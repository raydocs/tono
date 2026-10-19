#!/usr/bin/env bash
# Reproducible mutation-red run for TonoKit (round 12). Copies apps/ios/TonoKit at the checked-out
# commit to a scratch directory, applies one mutation at a time (the bug each test guards against),
# runs the guarding test with `swift test --filter`, and keeps the complete, unfiltered output.
# Usage: mutation-red.sh <out-dir>   (needs swift 5.9+ and python3 on PATH)
set -uo pipefail
OUT="$(mkdir -p "${1:?out dir}" && cd "$1" && pwd)"
ROOT="$(git rev-parse --show-toplevel)"
SCRATCH="$(mktemp -d)"; trap 'rm -rf "$SCRATCH"' EXIT
{
  echo "commit: $(git -C "$ROOT" rev-parse HEAD)"
  echo "TonoKit tree clean: $(git -C "$ROOT" status --porcelain -- apps/ios/TonoKit | wc -l | tr -d ' ') changed files"
  echo "swift: $(swift --version 2>&1 | head -1)"
  echo "host: $(uname -srm)"
  echo "date: $(date -u +%FT%TZ)"
} > "$OUT/00-environment.txt"

mutate() { # id file old new filter
  local id="$1" file="$2" old="$3" new="$4" filter="$5"
  rm -rf "$SCRATCH/TonoKit"; cp -R "$ROOT/apps/ios/TonoKit" "$SCRATCH/TonoKit"; rm -rf "$SCRATCH/TonoKit/.build"
  python3 - "$SCRATCH/TonoKit/$file" "$old" "$new" <<'PY' || { echo "$id: mutation did not apply" >> "$OUT/00-environment.txt"; return; }
import sys
p, old, new = sys.argv[1:4]
s = open(p).read()
assert s.count(old) == 1, f"{old!r} found {s.count(old)} times"
open(p, "w").write(s.replace(old, new))
PY
  { echo "\$ mutation $id in $file"; (cd "$SCRATCH" && diff -u "$ROOT/apps/ios/TonoKit/$file" "TonoKit/$file"); echo
    echo "\$ swift test --filter $filter"; (cd "$SCRATCH/TonoKit" && swift test --filter "$filter" 2>&1); echo "exit: $?"; } > "$OUT/$id.log" 2>&1
}

mutate M1-heartbeat-ignores-graph Sources/TonoKit/TunnelGraph.swift \
  'running: true, routing: running,' 'running: true, routing: true,' TunnelGraphTests
mutate M2-noreply-assumes-previous Sources/TonoKit/RouteApply.swift \
  '                outcome = .unconfirmed(requested)' '                outcome = .notApplied(code: "NO_REPLY", inEffect: previous)' RouteApplyTests
mutate M3-putback-error-swallowed Sources/TonoKit/RouteApply.swift \
  'do { try save(s) } catch { unsaved = s }' 'try? save(s)' RouteApplyTests
mutate M4-refused-inputs-left-in-file Sources/TonoKit/TunnelGraph.swift \
  '        if let last = inputs { persist(last) }' '' TunnelGraphTests
mutate M5-status-write-without-lock Sources/TonoKit/StatusFile.swift \
  'while flock(fd, LOCK_EX) != 0 {' 'while false {' StatusFileTests
mutate M6-app-write-always-wins Sources/TonoKit/StatusFile.swift \
  '        guard let current, current.writer == .tunnel' '        if true { return app }
        guard let current, current.writer == .tunnel' StatusFileTests
mutate M7-putback-obligation-dropped Sources/TonoKit/RouteApply.swift \
  'wrote ? unsaved : unsaved ?? before' 'unsaved' RouteApplyTests
