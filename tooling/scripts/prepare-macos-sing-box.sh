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
  93fff5954390367dd456cad3cbd79be54f8b941f
git -C "$work/source" checkout -q --detach FETCH_HEAD
export PATH="$work/go/bin:$PATH" GOENV=off GOWORK=off GOTOOLCHAIN=local
export GOFLAGS=-mod=readonly GOTELEMETRY=off
# Explicit cache preparation, not a fallback inside the offline builder.
go -C "$work/source" mod download
sh "$repo/tooling/scripts/build-sing-box.sh" build \
  --source "$work/source" --go "$work/go/bin/go" \
  --target darwin-arm64 --output "$work/darwin"
sh "$repo/tooling/scripts/build-sing-box.sh" verify \
  --go "$work/go/bin/go" --target darwin-arm64 \
  --binary "$work/darwin/sing-box" --manifest "$work/darwin/manifest.json" \
  --manifest-sha256 c765b9d2cc7d1cb31debd9bc699cb906bdd495e0cde08f401527879ac7eb394a
echo "6c86720c7baf60057ad9ea05b64149939d29a37397e93599563de0db5677baae  $work/darwin/sing-box" | sha256sum -c -
install -m 755 "$work/darwin/sing-box" "$repo/apps/macos/Tono/Resources/sing-box"
