#!/usr/bin/env bash
set -uo pipefail

# bash, not zsh: this has to execute on the Ubuntu runners too, and those do not
# ship zsh. A check that cannot execute where it is wired in is not a check.

# What actually runs is decided by two hand-maintained lists: the suites named by
# a workflow, and the suites `test-macos-all.sh` calls. A suite in neither list is
# not coverage. It compiles nothing, proves nothing, and reports nothing, and
# because it never runs it also never goes red when the source it extracts moves
# out from under it — it simply stays a file.
#
# That drift is invisible from either side. Adding a suite and forgetting to wire
# it in looks exactly like adding a suite. So membership itself is the thing under
# test, checked from outside both lists: every `test-*.sh` in this directory and
# every `test_*.py`, `*.test.rb` and `*.test.mjs` under `tests/` must be named, by
# its repository-relative path, in `.github/workflows` or in the aggregate script.
#
# Every naming convention this directory uses, not one of them. A check that
# enumerates only the extensions someone thought of is evaded by writing the next
# suite in another language, and it reports the same green either way.
#
# A suite named only by the aggregate runs where an operator runs the aggregate;
# no workflow calls `test-macos-all.sh`. Wiring a suite into a workflow is what
# makes it run on every change.

script_path=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/$(basename -- "${BASH_SOURCE[0]}")
scripts_dir=$(dirname -- "$script_path")
repo_root=$(cd -- "$scripts_dir/../.." && pwd)

fail() { printf 'test-suite-reachability: %s\n' "$1" >&2; exit 1; }

workflows_dir="$repo_root/.github/workflows"
aggregate="$scripts_dir/test-macos-all.sh"

[[ -d $workflows_dir ]] || fail "missing .github/workflows; membership cannot be checked"
[[ -f $aggregate ]] || fail "missing test-macos-all.sh; membership cannot be checked"

# Comments are stripped before the search, and so is any line that is a bare YAML
# sequence entry — a path under `on: … paths:` reads exactly like a reference
# while invoking nothing. Prose or a trigger filter that happens to quote a
# suite's path would otherwise satisfy this check without running anything, which
# is the failure mode it exists to prevent.
references=$(
  {
    cat "$workflows_dir"/*.yml "$workflows_dir"/*.yaml 2>/dev/null
    cat "$aggregate"
  } | /usr/bin/sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*-[[:space:]][^[:space:]]*$/d'
)

shopt -s nullglob
suites=("$scripts_dir"/test-*.sh "$scripts_dir"/tests/test_*.py \
        "$scripts_dir"/tests/*.test.rb "$scripts_dir"/tests/*.test.mjs)
shopt -u nullglob

# Expanded the long way, and the unreachable list accumulated as text rather than
# as an array. `bash` on the macOS runners is 3.2, where an empty array expanded
# under `set -u` aborts the shell — which on the green path is every run in which
# nothing is unreachable.
unreachable=""
checked=0
for suite in ${suites[@]+"${suites[@]}"}; do
  # The aggregate is where the others are registered, so it is not itself
  # something to look up.
  [[ $suite == "$aggregate" ]] && continue
  relative=${suite#"$repo_root/"}
  checked=$((checked + 1))
  if ! printf '%s\n' "$references" | /usr/bin/grep -qF -- "$relative"; then
    unreachable="$unreachable  - $relative
"
  fi
done

(( checked > 0 )) || fail "no test suites found under tooling/scripts"

if [[ -n $unreachable ]]; then
  printf 'test-suite-reachability: these suites are run by no workflow and by no aggregate:\n' >&2
  printf '%s' "$unreachable" >&2
  printf 'add each to a job in .github/workflows or to tooling/scripts/test-macos-all.sh\n' >&2
  exit 1
fi

printf 'test suite reachability: %s/%s suites are wired into CI or the aggregate\n' \
  "$checked" "$checked"
