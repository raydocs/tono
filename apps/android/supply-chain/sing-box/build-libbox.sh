#!/usr/bin/env bash
# Builds libbox.aar from the pinned sing-box alpha source with the upstream
# toolchain. Every network input is verified: the Go archive by SHA-256, the
# source by exact commit, Go modules by go.sum and the Go checksum database.
# Usage: supply-chain/sing-box/build-libbox.sh <output-dir>
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=sing-box.pin
source "$HERE/sing-box.pin"
OUT="${1:?usage: build-libbox.sh <output-dir>}"
mkdir -p "$OUT" && OUT="$(cd "$OUT" && pwd)"  # absolute: gomobile runs from the source tree
WORK="${TONO_SB_WORK:-$HOME/.tono-tools/sing-box-build}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/.android-sdk}"
JAVA_HOME="${JAVA_HOME:-$HOME/.tono-tools/jdk-17}"
mkdir -p "$WORK" "$OUT"

GO_ARCHIVE="$WORK/go${GO_VERSION}.linux-amd64.tar.gz"
[[ -f "$GO_ARCHIVE" ]] || curl --fail --location --retry 3 \
  "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o "$GO_ARCHIVE"
echo "$GO_LINUX_AMD64_SHA256  $GO_ARCHIVE" | sha256sum --check --status \
  || { echo "Go archive SHA-256 mismatch" >&2; exit 1; }
if [[ ! -x "$WORK/go/bin/go" ]]; then
  rm -rf "$WORK/go"; tar -xzf "$GO_ARCHIVE" -C "$WORK"
fi
export GOROOT="$WORK/go" GOPATH="$WORK/gopath" GOTOOLCHAIN=local GOFLAGS=-mod=readonly
export PATH="$GOROOT/bin:$GOPATH/bin:$JAVA_HOME/bin:$PATH"
[[ "$(go env GOVERSION)" == "go${GO_VERSION}" ]] || { echo "unexpected Go version" >&2; exit 1; }

if [[ ! -f "$ANDROID_HOME/ndk/$NDK_REVISION/source.properties" ]]; then
  # Licence answers via process substitution: `yes |` dies of SIGPIPE, which pipefail turns into a failure.
  "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --install "$NDK_PACKAGE" < <(yes) >/dev/null
fi
grep -q "Pkg.Revision = $NDK_REVISION" "$ANDROID_HOME/ndk/$NDK_REVISION/source.properties"
export ANDROID_HOME ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$NDK_REVISION"

SRC="$WORK/sing-box-$SING_BOX_COMMIT"
if [[ ! -d "$SRC/.git" ]]; then
  rm -rf "$SRC"
  git clone --quiet --depth 1 --branch "$SING_BOX_TAG" "$SING_BOX_REPO" "$SRC"
fi
[[ "$(git -C "$SRC" rev-parse HEAD)" == "$SING_BOX_COMMIT" ]] \
  || { echo "sing-box source is not commit $SING_BOX_COMMIT" >&2; exit 1; }
[[ -z "$(git -C "$SRC" status --porcelain)" ]] || { echo "sing-box source tree is dirty" >&2; exit 1; }

go install "$GOMOBILE_MODULE/cmd/gomobile@$GOMOBILE_VERSION" "$GOMOBILE_MODULE/cmd/gobind@$GOMOBILE_VERSION"

LDFLAGS="-X github.com/sagernet/sing-box/constant.Version=$SING_BOX_VERSION -X runtime.godebugDefault=multipathtcp=0,tlssha1=1 -checklinkname=0 -s -w -buildid="
cd "$SRC"
go mod download
go mod verify
GOMAXPROCS="${GOMAXPROCS:-2}" gomobile bind -v -o "$OUT/libbox.aar" \
  -target "$LIBBOX_TARGETS" -androidapi "$ANDROID_API" \
  -javapkg=io.nekohasekai -libname=box \
  -trimpath -buildvcs=false -ldflags "$LDFLAGS" \
  -tags "$LIBBOX_TAGS" ./experimental/libbox
rm -f "$OUT/libbox-sources.jar"
(cd "$OUT" && sha256sum libbox.aar > libbox.aar.sha256)
cat > "$OUT/libbox.provenance.json" <<JSON
{
  "component": "sing-box libbox",
  "version": "$SING_BOX_VERSION",
  "sourceCommit": "$SING_BOX_COMMIT",
  "license": "GPL-3.0-or-later (with upstream name-use restriction)",
  "go": "go$GO_VERSION",
  "gomobile": "$GOMOBILE_MODULE@$GOMOBILE_VERSION",
  "ndk": "$NDK_REVISION",
  "androidApi": $ANDROID_API,
  "targets": "$LIBBOX_TARGETS",
  "tags": "$LIBBOX_TAGS",
  "aarSha256": "$(cut -d' ' -f1 "$OUT/libbox.aar.sha256")"
}
JSON
echo "built $OUT/libbox.aar"
