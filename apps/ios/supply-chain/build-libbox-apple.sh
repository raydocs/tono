#!/usr/bin/env bash
# Builds Libbox.xcframework (ios + iossimulator) from the pinned sing-box alpha with the upstream
# toolchain. Runs on macOS with Xcode only. Every network input is verified: the Go archive by
# SHA-256, the source by exact commit and clean tree, the iOS Go patch by SHA-256, Go modules by
# go.sum and the Go checksum database. Nothing is signed or uploaded.
#
# usage: apps/ios/supply-chain/build-libbox-apple.sh            # → apps/ios/Frameworks/Libbox.xcframework
#        TONO_SB_WORK=/path/to/cache apps/ios/supply-chain/build-libbox-apple.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=sing-box.pin
source "$HERE/sing-box.pin"
OUT="$(cd "$HERE/.." && pwd)/Frameworks"
WORK="${TONO_SB_WORK:-$HOME/.tono-tools/sing-box-apple}"
[[ "$(uname -s)" == "Darwin" ]] || { echo "Libbox.xcframework needs macOS with Xcode" >&2; exit 1; }
xcrun --sdk iphoneos --show-sdk-version >/dev/null || { echo "Xcode iPhoneOS SDK not found" >&2; exit 1; }
mkdir -p "$WORK" "$OUT"

case "$(uname -m)" in
  arm64) GO_ARCH=arm64; GO_SHA="$GO_DARWIN_ARM64_SHA256" ;;
  x86_64) GO_ARCH=amd64; GO_SHA="$GO_DARWIN_AMD64_SHA256" ;;
  *) echo "unsupported host $(uname -m)" >&2; exit 1 ;;
esac
GO_ARCHIVE="$WORK/go${GO_VERSION}.darwin-${GO_ARCH}.tar.gz"
[[ -f "$GO_ARCHIVE" ]] || curl --fail --location --retry 3 "https://go.dev/dl/go${GO_VERSION}.darwin-${GO_ARCH}.tar.gz" -o "$GO_ARCHIVE"
echo "$GO_SHA  $GO_ARCHIVE" | shasum -a 256 --check --status || { echo "Go archive SHA-256 mismatch" >&2; exit 1; }
# A private Go copy, extracted fresh from the verified archive on every run (a cached work dir
# never supplies the toolchain): the upstream iOS CPU-feature patch edits GOROOT, never a shared install.
GOROOT_DIR="$WORK/go-${GO_VERSION}-ios"
rm -rf "$WORK/go" "$GOROOT_DIR"
tar -xzf "$GO_ARCHIVE" -C "$WORK"
mv "$WORK/go" "$GOROOT_DIR"
export GOROOT="$GOROOT_DIR" GOPATH="$WORK/gopath" GOTOOLCHAIN=local GOFLAGS=-mod=readonly
export PATH="$GOROOT/bin:$GOPATH/bin:$PATH"
[[ "$(go env GOVERSION)" == "go${GO_VERSION}" ]] || { echo "unexpected Go version" >&2; exit 1; }

SRC="$WORK/sing-box-$SING_BOX_COMMIT"
if [[ ! -d "$SRC/.git" ]]; then
  rm -rf "$SRC"
  git clone --quiet --depth 1 --branch "$SING_BOX_TAG" "$SING_BOX_REPO" "$SRC"
fi
[[ "$(git -C "$SRC" rev-parse HEAD)" == "$SING_BOX_COMMIT" ]] || { echo "sing-box source is not commit $SING_BOX_COMMIT" >&2; exit 1; }
[[ -z "$(git -C "$SRC" status --porcelain)" ]] || { echo "sing-box source tree is dirty" >&2; exit 1; }

PATCH="$SRC/.github/go_ios_cpu_features.patch"
echo "$GO_IOS_PATCH_SHA256  $PATCH" | shasum -a 256 --check --status || { echo "iOS Go patch SHA-256 mismatch" >&2; exit 1; }
(cd "$GOROOT" && patch -p1 --quiet < "$PATCH")
GOOS=ios GOARCH=arm64 CGO_ENABLED=0 go list -f '{{.GoFiles}}' internal/cpu | grep -q cpu_arm64_ios.go \
  || { echo "iOS Go patch is not effective" >&2; exit 1; }

go install "$GOMOBILE_MODULE/cmd/gomobile@$GOMOBILE_VERSION" "$GOMOBILE_MODULE/cmd/gobind@$GOMOBILE_VERSION"

LDFLAGS="-X github.com/sagernet/sing-box/constant.Version=$SING_BOX_VERSION -X runtime.godebugDefault=multipathtcp=0,tlssha1=1 -checklinkname=0 -s -w -buildid="
cd "$SRC"
go mod download
go mod verify
rm -rf Libbox.xcframework
gomobile bind -v -target "$LIBBOX_TARGETS" -libname=box -iosversion="$IOS_DEPLOYMENT_TARGET" \
  -trimpath -buildvcs=false -ldflags "$LDFLAGS" -tags "$LIBBOX_TAGS" ./experimental/libbox
rm -rf "$OUT/Libbox.xcframework"
mv Libbox.xcframework "$OUT/Libbox.xcframework"

# Tree digest: SHA-256 of the sorted "<sha256>  <path>" list of every file in the framework.
TREE_SHA="$(cd "$OUT" && find Libbox.xcframework -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1)"
cat > "$OUT/Libbox.provenance.json" <<JSON
{
  "component": "sing-box libbox (Apple)",
  "version": "$SING_BOX_VERSION",
  "sourceCommit": "$SING_BOX_COMMIT",
  "license": "GPL-3.0-or-later (with upstream name-use restriction)",
  "go": "go$GO_VERSION (upstream go_ios_cpu_features.patch applied)",
  "gomobile": "$GOMOBILE_MODULE@$GOMOBILE_VERSION",
  "xcode": "$(xcodebuild -version | tr '\n' ' ' | sed 's/ *$//')",
  "iphoneosSDK": "$(xcrun --sdk iphoneos --show-sdk-version)",
  "targets": "$LIBBOX_TARGETS",
  "iosDeploymentTarget": "$IOS_DEPLOYMENT_TARGET",
  "tags": "$LIBBOX_TAGS",
  "xcframeworkTreeSha256": "$TREE_SHA"
}
JSON
echo "built $OUT/Libbox.xcframework (tree sha256 $TREE_SHA)"
