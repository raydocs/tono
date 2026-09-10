#!/usr/bin/env bash
# Run a command while holding one of N slots — a counting semaphore across
# processes, so several agents on the same machine can share one Playwright
# install, one wrangler port range, or one browser farm without booking the
# whole thing.
#
# Usage: tooling/scripts/with-slot.sh <lockname> <max> -- <cmd…>
#   tooling/scripts/with-slot.sh playwright 1 -- npx playwright test --workers=2
#
# Slots are `/tmp/tono-<lockname>.<N>.lock`, N from 1 to <max>. With `flock`
# available they are files held open for the life of the command; without it
# (stock macOS has no flock) they are lock directories created with `mkdir`,
# which is atomic on every filesystem we run on. Either way the command's own
# exit status is what this script exits with.
#
# Environment:
#   WITH_SLOT_TIMEOUT   seconds to wait for a free slot before giving up
#                       (default 3600; 0 waits forever)
#   WITH_SLOT_QUIET     set to 1 to suppress the "waiting for a slot" line

set -u

usage() {
  echo "usage: with-slot.sh <lockname> <max> -- <cmd...>" >&2
  exit 2
}

[ $# -ge 4 ] || usage

NAME=$1
MAX=$2
shift 2
[ "$1" = "--" ] || usage
shift

case "$NAME" in
  ''|*[!A-Za-z0-9._-]*) echo "with-slot.sh: bad lock name: $NAME" >&2; exit 2 ;;
esac
case "$MAX" in
  ''|*[!0-9]*) echo "with-slot.sh: max must be a positive integer: $MAX" >&2; exit 2 ;;
esac
[ "$MAX" -ge 1 ] || usage

TIMEOUT=${WITH_SLOT_TIMEOUT:-3600}
QUIET=${WITH_SLOT_QUIET:-0}
WAITED=0
ANNOUNCED=0

announce_wait() {
  [ "$QUIET" = "1" ] && return 0
  [ "$ANNOUNCED" = "1" ] && return 0
  ANNOUNCED=1
  echo "with-slot: all $MAX '$NAME' slots are busy, waiting…" >&2
}

expired() {
  [ "$TIMEOUT" -eq 0 ] && return 1
  [ "$WAITED" -ge "$TIMEOUT" ]
}

slot_path() {
  echo "/tmp/tono-$NAME.$1.lock"
}

# --- flock path --------------------------------------------------------------
# fd 9 is held for the life of the command; the kernel drops it on exit, so a
# killed run cannot leave the slot booked.
run_with_flock() {
  local i lock
  while :; do
    i=1
    while [ "$i" -le "$MAX" ]; do
      lock=$(slot_path "$i")
      exec 9>"$lock" || { echo "with-slot: cannot open $lock" >&2; exit 1; }
      if flock -n 9; then
        "$@"
        return $?
      fi
      exec 9>&-
      i=$((i + 1))
    done
    announce_wait
    expired && { echo "with-slot: timed out waiting for a '$NAME' slot" >&2; exit 75; }
    sleep 2
    WAITED=$((WAITED + 2))
  done
}

# --- mkdir path --------------------------------------------------------------
# `mkdir` fails if the directory exists, atomically, which is the whole lock.
# The holder's pid goes inside so a slot left behind by a killed process can be
# reclaimed rather than blocking the machine forever.
HELD=""

release_dir() {
  [ -n "$HELD" ] || return 0
  rm -f "$HELD/pid" 2>/dev/null
  rmdir "$HELD" 2>/dev/null
  HELD=""
}

reap_if_dead() {
  local dir=$1 pid
  pid=$(cat "$dir/pid" 2>/dev/null) || return 1
  case "$pid" in
    ''|*[!0-9]*) return 1 ;;
  esac
  kill -0 "$pid" 2>/dev/null && return 1
  rm -f "$dir/pid" 2>/dev/null
  rmdir "$dir" 2>/dev/null
}

run_with_mkdir() {
  local i dir status
  trap 'release_dir' EXIT
  trap 'release_dir; exit 130' INT
  trap 'release_dir; exit 143' TERM
  while :; do
    i=1
    while [ "$i" -le "$MAX" ]; do
      dir=$(slot_path "$i")
      if mkdir "$dir" 2>/dev/null; then
        HELD=$dir
        echo $$ > "$dir/pid"
        "$@"
        status=$?
        release_dir
        return $status
      fi
      reap_if_dead "$dir"
      i=$((i + 1))
    done
    announce_wait
    expired && { echo "with-slot: timed out waiting for a '$NAME' slot" >&2; exit 75; }
    sleep 2
    WAITED=$((WAITED + 2))
  done
}

if command -v flock >/dev/null 2>&1; then
  run_with_flock "$@"
else
  run_with_mkdir "$@"
fi
