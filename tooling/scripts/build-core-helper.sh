#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
source_file="$repo_dir/tooling/scripts/core-helper/main.swift"
kill_switch_source="$repo_dir/tooling/scripts/core-helper/KillSwitchManager.swift"
protected_dns_source="$repo_dir/tooling/scripts/core-helper/ProtectedDNSManager.swift"
peer_authorization_source="$repo_dir/tooling/scripts/helper-shared/PeerAuthorization.swift"
protocol_version_source="$repo_dir/apps/macos/Tono/Core/HelperProtocolVersion.swift"
output_file="$repo_dir/apps/macos/Tono/Resources/liquidclash-helper"
temporary_file="$output_file.new"
contract_file="$repo_dir/tooling/scripts/core-helper/CONTRACT.sha256"

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
helper_sources_hash=$(cat \
  "$source_file" \
  "$kill_switch_source" \
  "$protected_dns_source" \
  "$peer_authorization_source" \
  "$protocol_version_source" \
  | sed -E '/^[[:space:]]*\/\//d; /^[[:space:]]*$/d' | shasum -a 256 | cut -d' ' -f1)
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
fi
module_cache_dir=$(mktemp -d /tmp/tono-helper-module-cache.XXXXXX)

trap 'rm -f "$temporary_file"; rm -rf "$module_cache_dir"' EXIT
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
xcrun swiftc \
  -O \
  -whole-module-optimization \
  -module-cache-path "$module_cache_dir" \
  -target arm64-apple-macosx26.3 \
  "$source_file" \
  "$kill_switch_source" \
  "$protected_dns_source" \
  "$peer_authorization_source" \
  "$protocol_version_source" \
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
rm -rf "$module_cache_dir"
trap - EXIT
