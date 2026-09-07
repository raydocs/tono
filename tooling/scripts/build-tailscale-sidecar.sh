#!/bin/sh
set -eu

# Reproducible source pin. Update only after reviewing upstream changes and notices.
TAILSCALE_TAG="v1.102.3"
TAILSCALE_COMMIT="53a0d659afa51835dd7a9283873cca44261454f8"
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
BUILD=$(mktemp -d "${TMPDIR:-/tmp}/tono-tailscale.XXXXXX")
trap 'rm -rf "$BUILD"' EXIT INT TERM

git clone --filter=blob:none --no-checkout https://github.com/tailscale/tailscale.git "$BUILD/src"
git -C "$BUILD/src" fetch --depth 1 origin "refs/tags/$TAILSCALE_TAG:refs/tags/$TAILSCALE_TAG"
git -C "$BUILD/src" checkout --detach "$TAILSCALE_TAG"
test "$(git -C "$BUILD/src" rev-parse HEAD)" = "$TAILSCALE_COMMIT" || { echo "Source commit mismatch" >&2; exit 1; }

mkdir -p "$ROOT/apps/macos/Tono/Resources"
(cd "$BUILD/src" && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags='-s -w' -o "$ROOT/apps/macos/Tono/Resources/tailscaled" ./cmd/tailscaled)
(cd "$BUILD/src" && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags='-s -w' -o "$ROOT/apps/macos/Tono/Resources/tailscale" ./cmd/tailscale)
chmod 755 "$ROOT/apps/macos/Tono/Resources/tailscaled" "$ROOT/apps/macos/Tono/Resources/tailscale"
echo "Built $TAILSCALE_TAG ($TAILSCALE_COMMIT). Sign both binaries with the app's Developer ID/team before archive/notarization."
