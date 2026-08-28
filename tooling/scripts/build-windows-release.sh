#!/bin/zsh
set -euo pipefail

repo_root=${0:A:h:h:h}
windows_root="$repo_root/apps/windows"
app_root="$windows_root/app"
toolchain_root="$windows_root/.toolchain"
version=${1:-}

if [[ ! $version =~ '^[0-9]+\.[0-9]+\.[0-9]+$' ]]; then
  echo "usage: $0 <major.minor.patch>" >&2
  exit 2
fi
if [[ ! -x "$toolchain_root/cargo/bin/cargo" ||
      ! -x "$toolchain_root/cargo/bin/cargo-xwin" ||
      ! -x "$toolchain_root/bin/pnpm" ]]; then
  echo "the pinned Windows toolchain is incomplete" >&2
  exit 1
fi

export CARGO_HOME="$toolchain_root/cargo"
export RUSTUP_HOME="$toolchain_root/rustup"
export XWIN_CACHE_DIR="$toolchain_root/xwin"
export PATH="$CARGO_HOME/bin:$toolchain_root/xwin:/opt/homebrew/opt/llvm/bin:$PATH"

(
  cd "$app_root"
  "$toolchain_root/bin/pnpm" release-version "$version"
  # Fail before the multi-hour Windows build if packaging still looks like Test 5
  # (dual Mihomo / whole-directory resources that pull Unix helpers).
  "$toolchain_root/bin/pnpm" release:preflight --config-only
)

"$repo_root/tooling/scripts/build-mihomo-adaptive.sh" --install-adaptive-windows

# The Service refuses to start a core whose SHA-256 does not match a pin, so the pin must be
# taken from the very binary this build ships. The sidecar is what Tauri installs as
# tono-core.exe, byte for byte, so hashing it here is hashing what will actually run.
# Without this the build would produce a Service that fail-closed refuses every connect.
core_sidecar="$app_root/src-tauri/sidecar/tono-core-x86_64-pc-windows-msvc.exe"
if [[ ! -f $core_sidecar ]]; then
  echo "core sidecar missing, cannot pin its digest: $core_sidecar" >&2
  exit 1
fi
TONO_CORE_SHA256=$(/usr/bin/shasum -a 256 "$core_sidecar" | /usr/bin/cut -d' ' -f1)
export TONO_CORE_SHA256
echo "pinning core digest for the Service: $TONO_CORE_SHA256"
printf '%s\n' "$TONO_CORE_SHA256" > "$app_root/src-tauri/resources/core-sha256.txt"

(
  cd "$windows_root"
  cargo xwin build --manifest-path service/Cargo.toml --release \
    --target x86_64-pc-windows-msvc --features standalone,client \
    --bin tono-service --bin tono-service-install --bin tono-service-uninstall
)
for name in tono-service tono-service-install tono-service-uninstall; do
  /usr/bin/install -m 755 \
    "$windows_root/service/target/x86_64-pc-windows-msvc/release/$name.exe" \
    "$app_root/src-tauri/resources/$name.exe"
done

(
  cd "$app_root"
  eval "$(cargo xwin env --target x86_64-pc-windows-msvc)"
  # cargo-xwin's environment replaces PATH; restore the local pnpm shim for
  # Tauri's beforeBuildCommand.
  export PATH="$toolchain_root/bin:$PATH"
  cargo tauri build --target x86_64-pc-windows-msvc
)

installer="$app_root/target/x86_64-pc-windows-msvc/release/bundle/nsis/Tono_${version}_x64-setup.exe"
if [[ ! -f $installer ]]; then
  echo "installer not found: $installer" >&2
  exit 1
fi
/usr/bin/file "$installer"
/usr/bin/shasum -a 256 "$installer"

# Payload truth for Test 6: the same unpack gate the PowerShell build and the release
# workflow run, so all three paths refuse the same installer. It unpacks the NSIS
# archive to reject dual Mihomo / Unix helpers and to prove the shipped executables and
# core-sha256.txt carry the digest pinned above. A missing 7zz/7z is fatal inside the
# preflight itself, so this gate cannot skip.
(
  cd "$app_root"
  "$toolchain_root/bin/pnpm" release:preflight --payload-only "$installer"
)
