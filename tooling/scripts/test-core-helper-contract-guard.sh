#!/bin/sh
set -eu

# build-core-helper.sh must reject a CONTRACT.sha256 whose hash matches the
# helper sources but whose version differs from HelperProtocolVersion.current,
# and must keep the legitimate path where the version and the hash both moved.
# The script is copied into a mirror tree with a fake xcrun, so the guard runs
# and nothing is compiled: reaching xcrun (exit 73) means the guard accepted.

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
script="$repo_dir/tooling/scripts/build-core-helper.sh"
work=$(mktemp -d "/tmp/tono-helper-guard.XXXXXX")
case "$work" in
  /tmp/tono-helper-guard.*) ;;
  *) echo "unexpected temporary directory" >&2; exit 2 ;;
esac
trap 'rm -rf "$work"' EXIT

mirror="$work/repo"
mkdir -p "$mirror/tooling/scripts/core-helper" "$mirror/apps/macos/Tono/Core" \
  "$mirror/apps/macos/Tono/Models" "$mirror/apps/macos/Tono/Resources" \
  "$mirror/tooling/scripts/helper-shared" "$work/bin"
cp "$script" "$mirror/tooling/scripts/build-core-helper.sh"
printf '#!/bin/sh\nexit 73\n' > "$work/bin/xcrun"
chmod +x "$work/bin/xcrun"

# Every source in the script's manifest, in manifest order.
: > "$work/manifest"
sed -n 's|^  "\$helper_dir/\([^"]*\)".*|tooling/scripts/core-helper/\1|p;
        s|^  "\$repo_dir/\([^"]*\)".*|\1|p' "$script" > "$work/manifest"
while IFS= read -r path; do
  printf '// comment\nlet source = "%s"\n' "$path" > "$mirror/$path"
done < "$work/manifest"
printf 'static let current = "1.0.0"\n' \
  > "$mirror/apps/macos/Tono/Core/HelperProtocolVersion.swift"
printf '%s\n' apps/macos/Tono/Core/HelperProtocolVersion.swift >> "$work/manifest"

hash=$(while IFS= read -r path; do cat "$mirror/$path"; done < "$work/manifest" \
  | sed -E '/^[[:space:]]*\/\//d; /^[[:space:]]*$/d' | shasum -a 256 | cut -d' ' -f1)

run_guard() {
  printf '%s\n' "$1" > "$mirror/tooling/scripts/core-helper/CONTRACT.sha256"
  status=0
  PATH="$work/bin:$PATH" sh "$mirror/tooling/scripts/build-core-helper.sh" \
    > "$work/out" 2>&1 || status=$?
}

expect() {
  if [ "$status" != "$2" ]; then
    echo "FAIL: $1: expected exit $2, got $status" >&2
    cat "$work/out" >&2
    exit 1
  fi
}

run_guard "1.0.0 $hash"
expect "matching version and hash reaches the compiler" 73

run_guard "1.0.1 $hash"
expect "matching hash with a different recorded version is rejected" 1
grep -q 'records version 1.0.1' "$work/out" || {
  echo "FAIL: the rejection does not name the recorded version" >&2
  exit 1
}

run_guard "0.9.0 0000000000000000000000000000000000000000000000000000000000000000"
expect "fresh version with a stale hash still builds" 73

run_guard "1.0.0 0000000000000000000000000000000000000000000000000000000000000000"
expect "changed sources under an unchanged version are rejected" 1

echo "PASS build-core-helper contract guard"
