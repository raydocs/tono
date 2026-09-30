#!/bin/sh
# Disposable Linux CI build of the reviewed macOS input. No signing or publish.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
curl --fail --location --proto '=https' --tlsv1.2 \
  https://go.dev/dl/go1.27.1.linux-amd64.tar.gz -o "$work/go.tar.gz"
echo "63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445  $work/go.tar.gz" | sha256sum -c -
tar -xzf "$work/go.tar.gz" -C "$work"
git init -q "$work/source"
git -C "$work/source" fetch -q --depth=1 https://github.com/SagerNet/sing-box \
  132b38e9caaba1a1959354d518e54d2d08419afe
git -C "$work/source" checkout -q --detach FETCH_HEAD
export PATH="$work/go/bin:$PATH" GOENV=off GOWORK=off GOTOOLCHAIN=local
export GOFLAGS=-mod=readonly GOTELEMETRY=off
# Explicit cache preparation, not a fallback inside the offline builder.
go -C "$work/source" mod download
sh "$repo/tooling/scripts/build-sing-box.sh" build \
  --candidate "$repo/tooling/scripts/sing-box/candidates/v1.15.0-alpha.9.json" \
  --source "$work/source" --go "$work/go/bin/go" \
  --target darwin-arm64 --output "$work/darwin"
sh "$repo/tooling/scripts/build-sing-box.sh" verify \
  --candidate "$repo/tooling/scripts/sing-box/candidates/v1.15.0-alpha.9.json" \
  --go "$work/go/bin/go" --target darwin-arm64 \
  --binary "$work/darwin/sing-box" --manifest "$work/darwin/manifest.json" \
  --manifest-sha256 4932227756b774f2132f272878d554574584c7ebb69454c3c3ae44ccd1e1a40c
echo "ab0187a774e2515e7e6761e23ece0b656818cb4c31c983070b3fd023db172258  $work/darwin/sing-box" | sha256sum -c -
install -m 755 "$work/darwin/sing-box" "$repo/apps/macos/Tono/Resources/sing-box"
