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
  if status=$(git -C "$root" status --porcelain --untracked-files=normal 2>/dev/null); then
    dirty=false
    if [ -n "$status" ]; then dirty=true; fi
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
