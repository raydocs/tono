#!/bin/sh
# Bundle-local build checkout metadata, NOT a signature or release attestation.
set -eu
root=${SRCROOT:?SRCROOT is required}
output="${BUILT_PRODUCTS_DIR:?}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}/tono-build-source.json"
commit=$(git -C "$root" rev-parse HEAD 2>/dev/null || true)
case "$commit" in
  *[!0-9a-f]*|'') commit_json=null ;;
  *) if [ "${#commit}" -eq 40 ]; then commit_json="\"$commit\""; else commit_json=null; fi ;;
esac
dirty=null
if [ "$commit_json" != null ]; then
  # The helper binary is a build product: packaging recompiles it from tracked
  # sources (tooling/scripts/build-core-helper.sh) before this runs, and the
  # tracked copy lags behind them. Only the binary that builder left behind,
  # compiled from the helper sources as they are now, is exempt: a hand-edited
  # or stale binary still counts, and so do the helper's sources.
  helper=apps/macos/Tono/Resources/tono-core-helper
  if top=$(git -C "$root" rev-parse --show-toplevel 2>/dev/null) &&
     built=$(git -C "$root" rev-parse --git-path tono-core-helper.built 2>/dev/null); then
    case "$built" in /*) ;; *) built="$root/$built" ;; esac
    set -- ':(top)'
    if [ -f "$built" ]; then
      binary_hash=$(shasum -a 256 "$top/$helper" 2>/dev/null | cut -d' ' -f1)
      sources_hash=$(sh "$top/tooling/scripts/build-core-helper.sh" --sources-hash 2>/dev/null || true)
      if [ -n "$binary_hash" ] && [ -n "$sources_hash" ] &&
         [ "$(cat "$built")" = "$binary_hash $sources_hash" ]; then
        set -- "$@" ":(top,exclude)$helper"
      fi
    fi
    if status=$(git -C "$root" status --porcelain --untracked-files=normal -- "$@" 2>/dev/null); then
      dirty=false
      if [ -n "$status" ]; then dirty=true; fi
    fi
  fi
fi
case "${CONFIGURATION:-}" in
  Debug|Release) configuration=$CONFIGURATION ;;
  *) configuration=Unknown ;;
esac
sequence=${TONO_UPDATE_RELEASE_SEQUENCE:-null}
if [ "$sequence" != null ]; then
  case "$sequence" in
    ''|0*|*[!0-9]*) echo 'Invalid TONO_UPDATE_RELEASE_SEQUENCE' >&2; exit 1 ;;
  esac
  if [ "${#sequence}" -gt 16 ] || [ "$sequence" -gt 9007199254740991 ]; then
    echo 'TONO_UPDATE_RELEASE_SEQUENCE exceeds the shared contract' >&2
    exit 1
  fi
fi
mkdir -p "$(dirname "$output")"
printf '{"commit":%s,"dirty":%s,"configuration":"%s","releaseSequence":%s}\n' \
  "$commit_json" "$dirty" "$configuration" "$sequence" > "$output"
