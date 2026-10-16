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

# A wildcard invocation such as `node --test "tooling/scripts/tests/*.test.mjs"`
# runs every suite it matches without naming any of them. These are collected
# from the same stripped text, so a trigger filter (a bare sequence entry) or a
# comment still counts for nothing. Only the file name may carry the wildcard,
# and it must keep a literal character (`*.test.mjs`, not `*`), so a stray
# `tests/*` or `**` cannot register a whole tree it does not run.
globs=$(
  printf '%s\n' "$references" | tr -s '[:space:]' '\n' |
    /usr/bin/sed -e "s/^[\"'(]*//" -e "s/[\"')]*\$//" |
    /usr/bin/awk 'index($0, "*") && index($0, "/")'
)

# True when a wildcard invocation covers the suite at this repository-relative
# path. A leading ./ or ../ is dropped as for a named path; the directory must
# be the suite's own, and the file name is matched as a shell pattern.
covered_by_glob() {
  local relative=$1 glob glob_dir glob_name
  while IFS= read -r glob; do
    [[ -n $glob ]] || continue
    while [[ $glob == ./* || $glob == ../* ]]; do glob=${glob#*/}; done
    glob_dir=${glob%/*}
    glob_name=${glob##*/}
    [[ $glob_dir == *'*'* ]] && continue
    [[ $glob_name == *[!*]* ]] || continue
    [[ $glob_dir == "${relative%/*}" ]] || continue
    # shellcheck disable=SC2053 # the pattern is the point
    [[ ${relative##*/} == $glob_name ]] && return 0
  done <<EOF_GLOBS
$globs
EOF_GLOBS
  return 1
}

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
  # Read the complete input. An early-exit search can SIGPIPE printf, and
  # pipefail then reports a real reference as missing. A hit also has to be
  # the whole token: `test-wired.sh.skip` contains `test-wired.sh` and would
  # otherwise count as wiring while running nothing. A leading `../../` is
  # still a hit; a following path character is not.
  if covered_by_glob "$relative"; then
    continue
  fi
  if ! printf '%s\n' "$references" | /usr/bin/awk -v path="$relative" '
    BEGIN { found = 0 }
    {
      from = 1
      plen = length(path)
      while (from <= length($0)) {
        i = index(substr($0, from), path)
        if (i == 0) break
        pos = from + i - 1
        before = (pos == 1 ? "" : substr($0, pos - 1, 1))
        after_at = pos + plen
        after = (after_at > length($0) ? "" : substr($0, after_at, 1))
        before_ok = (before == "" || before !~ /[A-Za-z0-9_.-]/)
        after_ok = (after == "" || after !~ /[A-Za-z0-9_.\/-]/)
        if (before_ok && after_ok) found = 1
        from = pos + 1
      }
    }
    END { exit (found ? 0 : 1) }
  '; then
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
