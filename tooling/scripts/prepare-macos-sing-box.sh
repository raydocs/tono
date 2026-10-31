#!/bin/sh
# Disposable Linux CI build of the reviewed macOS input. No signing or publish.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
# Retry the tarball and the pinned fetch. A dropped HTTP/2 stream (curl 92)
# failed the macOS input job once; the checksum and the commit below still
# have to match or the script exits.
curl --fail --location --proto '=https' --tlsv1.2 \
  --retry 5 --retry-all-errors --retry-delay 2 \
  https://go.dev/dl/go1.27.1.linux-amd64.tar.gz -o "$work/go.tar.gz"
echo "63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445  $work/go.tar.gz" | sha256sum -c -
tar -xzf "$work/go.tar.gz" -C "$work"
git init -q "$work/source"
attempt=0
while true; do
  if git -C "$work/source" fetch -q --depth=1 https://github.com/SagerNet/sing-box \
    824dbcfb4dd0a95921840b1737b950cde590241e; then
    break
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 5 ]; then
    echo "pinned sing-box fetch failed" >&2
    exit 1
  fi
  sleep 2
done
git -C "$work/source" checkout -q --detach FETCH_HEAD
export PATH="$work/go/bin:$PATH" GOENV=off GOWORK=off GOTOOLCHAIN=local
export GOFLAGS=-mod=readonly GOTELEMETRY=off
# Explicit cache preparation, not a fallback inside the offline builder.
go -C "$work/source" mod download
sh "$repo/tooling/scripts/build-sing-box.sh" build \
  --candidate "$repo/tooling/scripts/sing-box/candidates/v1.15.0-alpha.13.json" \
  --source "$work/source" --go "$work/go/bin/go" \
  --target darwin-arm64 --output "$work/darwin"
sh "$repo/tooling/scripts/build-sing-box.sh" verify \
  --candidate "$repo/tooling/scripts/sing-box/candidates/v1.15.0-alpha.13.json" \
  --go "$work/go/bin/go" --target darwin-arm64 \
  --binary "$work/darwin/sing-box" --manifest "$work/darwin/manifest.json" \
  --manifest-sha256 331c6cc41d53ae35d71fbcfddf70bb289e9414bca2248e87c12463a7614cb31d
echo "647fb45b72a32b1cd324665010baf5141dedb347b4dedc66e61fce73e5076dce  $work/darwin/sing-box" | sha256sum -c -
install -m 755 "$work/darwin/sing-box" "$repo/apps/macos/Tono/Resources/sing-box"
