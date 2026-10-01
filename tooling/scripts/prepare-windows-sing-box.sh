#!/bin/sh
# Disposable Linux CI build of the reviewed Windows sing-box input. No signing or publish.
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
    132b38e9caaba1a1959354d518e54d2d08419afe; then
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
  --candidate "$repo/tooling/scripts/sing-box/candidates/v1.15.0-alpha.9.json" \
  --source "$work/source" --go "$work/go/bin/go" \
  --target windows-amd64-v2 --output "$work/windows"
sh "$repo/tooling/scripts/build-sing-box.sh" verify \
  --candidate "$repo/tooling/scripts/sing-box/candidates/v1.15.0-alpha.9.json" \
  --go "$work/go/bin/go" --target windows-amd64-v2 \
  --binary "$work/windows/sing-box.exe" --manifest "$work/windows/manifest.json" \
  --manifest-sha256 6a14337fdd5fbb328524e8edb7390f082c9e39fe3a262916716a1da89c02b591
echo "b2e6902ee75d9c4af79df28a61ded67afc4283fc83a44dee8896f3737a4ed027  $work/windows/sing-box.exe" | sha256sum -c -
mkdir -p "$repo/apps/windows/app/src-tauri/sidecar"
install -m 755 "$work/windows/sing-box.exe" "$repo/apps/windows/app/src-tauri/sidecar/sing-box-x86_64-pc-windows-msvc.exe"
