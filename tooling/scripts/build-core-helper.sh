#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
helper_dir="$repo_dir/tooling/scripts/core-helper"
protocol_version_source="$repo_dir/apps/macos/Tono/Core/HelperProtocolVersion.swift"
output_file="$repo_dir/apps/macos/Tono/Resources/tono-core-helper"
temporary_file="$output_file.new"
mode=${1:-}
case "$mode" in
  ''|--build-fingerprint) ;;
  *) echo "build-core-helper: unknown argument $mode" >&2; exit 2 ;;
esac
contract_file="$helper_dir/CONTRACT.sha256"
# One manifest for both CONTRACT hashing and swiftc. Adding a helper source
# without listing it here would compile an old daemon while the hash gate
# passed on a subset of files.
set -- \
  "$helper_dir/main.swift" \
  "$helper_dir/CoreManager.swift" \
  "$helper_dir/HelperHTTP.swift" \
  "$helper_dir/HelperPower.swift" \
  "$helper_dir/SocketServer.swift" \
  "$helper_dir/KillSwitchManager.swift" \
  "$helper_dir/KillSwitchPF.swift" \
  "$helper_dir/SelectiveFailOpen.swift" \
  "$helper_dir/KillSwitchTests.swift" \
  "$helper_dir/ProtectedDNSManager.swift" \
  "$helper_dir/UpdateStorage.swift" \
  "$helper_dir/UpdatePackage.swift" \
  "$helper_dir/UpdateRuntime.swift" \
  "$helper_dir/UpdateTransaction.swift" \
  "$helper_dir/UpdateExecutor.swift" \
  "$helper_dir/UpdateTests.swift" \
  "$repo_dir/apps/macos/Tono/Models/UpdateContractV1.swift" \
  "$repo_dir/tooling/scripts/helper-shared/PeerAuthorization.swift" \
  "$protocol_version_source"

# The app decides whether to reinstall the daemon by comparing
# HelperProtocolVersion.current alone. Change helper behavior without changing
# that string and the old daemon runs forever while every downstream gate passes
# vacuously — that failure has shipped twice, once as a rejected request field
# and once as an unparseable PF rule. So: any change to helper sources must come
# with a version change. The recorded hash covers every source compiled below.
helper_version=$(sed -n 's/.*static let current = "\([^"]*\)".*/\1/p' \
  "$protocol_version_source")
if [ -z "$helper_version" ]; then
  echo "build-core-helper: cannot read HelperProtocolVersion.current" >&2
  exit 1
fi
# Whole-line comments and blank lines are stripped before hashing. Without that,
# editing a doc comment forced a protocol bump, and a bump forces an
# administrator prompt on every existing install — a real cost for a change no
# daemon can observe. Only lines whose first non-blank characters are `//` are
# removed, so nothing inside code or a string literal (`http://…`) is touched,
# and a trailing comment still counts as a change.
for helper_source in "$@"; do
  if [ ! -r "$helper_source" ]; then
    echo "build-core-helper: cannot read $helper_source" >&2
    exit 1
  fi
done
helper_sources_hash=$(cat "$@" \
  | sed -E '/^[[:space:]]*\/\//d; /^[[:space:]]*$/d' | shasum -a 256 | cut -d' ' -f1)
# What a build made right now would be made from: the sources above and this
# script, which holds the compiler flags and the manifest. Not the contract
# hash: a recipe change alone needs no protocol bump, but it does make an
# already built binary stale. write-build-source.sh asks for it.
build_fingerprint=$(printf '%s %s\n' "$helper_sources_hash" \
  "$(shasum -a 256 "$repo_dir/tooling/scripts/build-core-helper.sh" | cut -d' ' -f1)" | shasum -a 256 | cut -d' ' -f1)
if [ "$mode" = --build-fingerprint ]; then
  printf '%s\n' "$build_fingerprint"
  exit 0
fi
if [ -f "$contract_file" ]; then
  recorded_version=$(cut -d' ' -f1 "$contract_file")
  recorded_hash=$(cut -d' ' -f2 "$contract_file")
  if [ "$helper_sources_hash" != "$recorded_hash" ] &&
     [ "$helper_version" = "$recorded_version" ]; then
    echo "build-core-helper: helper sources changed but" \
      "HelperProtocolVersion.current is still $helper_version." >&2
    echo "  Bump it, or existing installs keep the old daemon and this" \
      "change reaches nobody." >&2
    exit 1
  fi
  # A build always writes the parsed source version next to the hash it just
  # computed. Identical bytes with a different recorded version therefore is not
  # a last-built record: the record was edited or merged without the version
  # source, and the app would keep trusting the old daemon.
  if [ "$helper_sources_hash" = "$recorded_hash" ] &&
     [ "$helper_version" != "$recorded_version" ]; then
    echo "build-core-helper: CONTRACT.sha256 records version" \
      "$recorded_version for these exact sources but" \
      "HelperProtocolVersion.current is $helper_version." >&2
    echo "  Make the two agree (the version source and the record)" \
      "before building." >&2
    exit 1
  fi
fi
module_cache_dir=$(mktemp -d /tmp/tono-helper-module-cache.XXXXXX)

trap 'rm -f "$temporary_file"; rm -rf "$module_cache_dir"' EXIT
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
xcrun swiftc \
  -O \
  -whole-module-optimization \
  -module-cache-path "$module_cache_dir" \
  -target arm64-apple-macosx26.3 \
  "$@" \
  -framework IOKit \
  -framework Security \
  -framework SystemConfiguration \
  -o "$temporary_file"
# This is an ad-hoc signature for local compilation only. The Release archive
# must re-sign the helper with the Tono Developer ID through CodeSignOnCopy;
# HelperManager and the installed daemon intentionally reject this ad-hoc copy.
codesign --force --sign - --identifier com.raydocs.tono.helper "$temporary_file"
chmod 0755 "$temporary_file"
"$temporary_file" --self-test
"$temporary_file" --version
mv -f "$temporary_file" "$output_file"
printf '%s %s\n' "$helper_version" "$helper_sources_hash" > "$contract_file"
# Tells write-build-source.sh that this exact binary came from the sources
# and recipe fingerprinted above, so rebuilding it does not mark the app build dirty. It lives in
# the git directory: never tracked, never part of a package. Best effort: with
# no record the binary simply counts as a modified file again.
if built_record=$(git -C "$repo_dir" rev-parse --git-path tono-core-helper.built 2>/dev/null); then
  case "$built_record" in /*) ;; *) built_record="$repo_dir/$built_record" ;; esac
  binary_hash=$(shasum -a 256 "$output_file" | cut -d' ' -f1)
  { printf '%s %s\n' "$binary_hash" "$build_fingerprint" > "$built_record"; } 2>/dev/null ||
    echo "build-core-helper: could not record the built helper; the app build will be stamped dirty" >&2
fi
rm -rf "$module_cache_dir"
trap - EXIT
