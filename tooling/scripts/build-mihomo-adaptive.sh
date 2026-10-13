#!/bin/zsh
set -euo pipefail

repo_root=${0:A:h:h:h}
mac_target="$repo_root/apps/macos/Tono/Resources/mihomo"
windows_target="$repo_root/apps/windows/app/src-tauri/sidecar/tono-core-x86_64-pc-windows-msvc.exe"
windows_alpha_target="$repo_root/apps/windows/app/src-tauri/sidecar/tono-core-alpha-x86_64-pc-windows-msvc.exe"
patch_file="$repo_root/tooling/scripts/mihomo-adaptive/gvisor-adaptive-buffer.patch"
mode=${1:---install-adaptive}

upstream_tag="v1.19.32"
upstream_commit="88dcbf7f1614a67c3b36b848ee3592dfa92ada36"
sing_tun_version="v0.4.27"
adaptive_version="v1.19.32-tono-gvisor-adaptive.2"
required_go_version="go1.27.2"
stock_archive_sha256="3312a6780652c622890fd4357c6a853bbf865464fd047ac7b7f52dab8de18652"
stock_binary_sha256="94a386ec0149080deadd86b1f667363bde3c70f7489dba3258e52c56fc9a6d66"
stock_url="https://github.com/MetaCubeX/mihomo/releases/download/$upstream_tag/mihomo-darwin-arm64-$upstream_tag.gz"
windows_stock_archive_sha256="1ee9e6a30c4ba3ba4eb6f0bc7027fe77016a4471eb851a03d44841e3313d4012"
windows_stock_binary_sha256="3c107d54ef1b895e4980b53f517d52f3c1137101fa2637347c9ce343fc50d7b2"
windows_stock_url="https://github.com/MetaCubeX/mihomo/releases/download/$upstream_tag/mihomo-windows-amd64-v2-$upstream_tag.zip"

work_dir=$(mktemp -d /tmp/tono-mihomo-adaptive.XXXXXX)
install_tmp=""
cleanup() {
  if [[ -n $install_tmp && -f $install_tmp ]]; then
    rm -f "$install_tmp"
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

sha256() {
  /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'
}

atomic_install() {
  local source=$1
  local target=$2
  local target_dir=${target:h}
  /bin/mkdir -p "$target_dir"
  install_tmp=$(mktemp "$target_dir/.mihomo.install.XXXXXX")
  /usr/bin/install -m 755 "$source" "$install_tmp"
  /bin/mv -f "$install_tmp" "$target"
  install_tmp=""
}

restore_stock() {
  local archive="$work_dir/mihomo-darwin-arm64-$upstream_tag.gz"
  /usr/bin/curl --fail --location --retry 3 --silent --show-error \
    --output "$archive" "$stock_url"
  local archive_digest=$(sha256 "$archive")
  if [[ $archive_digest != $stock_archive_sha256 ]]; then
    echo "stock archive checksum mismatch: $archive_digest" >&2
    exit 1
  fi
  /usr/bin/gzip -dk "$archive"
  local binary=${archive%.gz}
  local binary_digest=$(sha256 "$binary")
  if [[ $binary_digest != $stock_binary_sha256 ]]; then
    echo "stock binary checksum mismatch: $binary_digest" >&2
    exit 1
  fi
  atomic_install "$binary" "$mac_target"
  echo "restored official Mihomo $upstream_tag: $binary_digest"
}

restore_windows_stock() {
  local archive="$work_dir/mihomo-windows-amd64-v2-$upstream_tag.zip"
  /usr/bin/curl --fail --location --retry 3 --silent --show-error \
    --output "$archive" "$windows_stock_url"
  local archive_digest=$(sha256 "$archive")
  if [[ $archive_digest != $windows_stock_archive_sha256 ]]; then
    echo "Windows stock archive checksum mismatch: $archive_digest" >&2
    exit 1
  fi
  /usr/bin/unzip -q "$archive" -d "$work_dir/windows-stock"
  local binary="$work_dir/windows-stock/mihomo-windows-amd64-v2.exe"
  local binary_digest=$(sha256 "$binary")
  if [[ $binary_digest != $windows_stock_binary_sha256 ]]; then
    echo "Windows stock binary checksum mismatch: $binary_digest" >&2
    exit 1
  fi
  atomic_install "$binary" "$windows_target"
  atomic_install "$binary" "$windows_alpha_target"
  echo "restored official Windows Mihomo $upstream_tag: $binary_digest"
}

install_adaptive() {
  local platform=${1:-mac}
  local go_binary=$(command -v go)
  local git_binary=$(command -v git)
  if [[ -z $go_binary || -z $git_binary || ! -f $patch_file ]]; then
    echo "Go, Git, and the adaptive patch are required" >&2
    exit 1
  fi
  local go_version=$($go_binary env GOVERSION)
  if [[ $go_version != "$required_go_version" ]]; then
    echo "adaptive core requires $required_go_version; found $go_version" >&2
    exit 1
  fi

  local source_dir="$work_dir/mihomo"
  $git_binary clone --quiet --depth 1 --branch "$upstream_tag" \
    https://github.com/MetaCubeX/mihomo.git "$source_dir"
  local source_commit=$($git_binary -C "$source_dir" rev-parse HEAD)
  if [[ $source_commit != $upstream_commit ]]; then
    echo "unexpected Mihomo source commit: $source_commit" >&2
    exit 1
  fi

  (
    cd "$source_dir"
    $go_binary mod download "github.com/metacubex/sing-tun@$sing_tun_version"
  )
  local module_dir=$(
    cd "$source_dir"
    $go_binary list -mod=mod -m -f '{{.Dir}}' github.com/metacubex/sing-tun
  )
  local patched_tun="$work_dir/sing-tun"
  /bin/cp -R "$module_dir" "$patched_tun"
  /bin/chmod -R u+w "$patched_tun"
  /usr/bin/patch -s -d "$patched_tun" -p1 -i "$patch_file"

  (
    cd "$patched_tun"
    # The whole sing-tun suite runs, including the patch's TestTonoAdaptiveGVisorTCPBuffers.
    # One upstream test is skipped: sing-tun v0.4.27's TestMipsWindowsReadFailureExitsReadLoop
    # (mipstack, which Tono never selects: stack is gvisor) panics on a nil stack and takes
    # the whole package run down. Drop this skip once upstream fixes that test.
    $go_binary test -count=1 -tags with_gvisor \
      -skip '^TestMipsWindowsReadFailureExitsReadLoop$' .
  )
  (
    cd "$source_dir"
    $go_binary mod edit \
      -replace="github.com/metacubex/sing-tun=$patched_tun"
  )

  local output="$work_dir/mihomo-adaptive"
  local build_time=$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')
  local ldflags="-X github.com/metacubex/mihomo/constant.Version=$adaptive_version -X github.com/metacubex/mihomo/constant.BuildTime=$build_time -w -s -buildid="
  if [[ $platform == windows ]]; then
    output="$output.exe"
    (
      cd "$source_dir"
      CGO_ENABLED=0 GOOS=windows GOARCH=amd64 GOAMD64=v2 \
        $go_binary build -tags with_gvisor -trimpath \
        -ldflags "$ldflags" -o "$output" .
    )

    local file_description=$(/usr/bin/file "$output")
    local build_info=$($go_binary version -m "$output")
    local has_adaptive_version=false
    if /usr/bin/strings "$output" | /usr/bin/grep -F "$adaptive_version" >/dev/null; then
      has_adaptive_version=true
    fi
    if [[ $file_description != *"PE32+ executable"* ||
          $file_description != *"x86-64"* ||
          $build_info != *$'\tbuild\t-tags=with_gvisor'* ||
          $build_info != *$'\tbuild\tGOAMD64=v2'* ||
          $has_adaptive_version != true ]]; then
      echo "adaptive Windows binary verification failed" >&2
      echo "$file_description" >&2
      echo "$build_info" >&2
      exit 1
    fi
    atomic_install "$output" "$windows_target"
    echo "adaptive Windows Mihomo SHA-256: $(sha256 "$windows_target")"
  else
    (
      cd "$source_dir"
      CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
        $go_binary build -tags with_gvisor -trimpath \
        -ldflags "$ldflags" -o "$output" .
    )

    local file_description=$(/usr/bin/file "$output")
    local version_output=$($output -v)
    if [[ $file_description != *"Mach-O 64-bit executable arm64"* ||
          $version_output != *"$adaptive_version"* ||
          $version_output != *"Use tags: with_gvisor"* ]]; then
      echo "adaptive binary verification failed" >&2
      echo "$file_description" >&2
      echo "$version_output" >&2
      exit 1
    fi
    atomic_install "$output" "$mac_target"
    echo "$version_output"
    echo "adaptive Mihomo SHA-256: $(sha256 "$mac_target")"
  fi
  # Written as a fixed template rather than json.dumps so the layout stays
  # exactly what the Windows app's biome format check expects.
  local identity_json
  identity_json=$(cat <<JSON
{
  "tonoCoreVersion": "$adaptive_version",
  "mihomoUpstreamTag": "$upstream_tag",
  "upstreamCommit": "$upstream_commit",
  "tonoPatchRevision": "gvisor-adaptive.2",
  "goVersion": "$go_version",
  "buildTags": ["with_gvisor"],
  "singTun": "$sing_tun_version",
  "tcpBufferBytes": { "min": 4096, "default": 32768, "max": 2097152 }
}
JSON
  )
  printf '%s\n' "$identity_json" > "$repo_root/apps/windows/app/src-tauri/core-identity.json"
}

case $mode in
  --install-adaptive)
    install_adaptive
    ;;
  --install-adaptive-windows)
    install_adaptive windows
    ;;
  --restore-stock)
    restore_stock
    ;;
  --restore-stock-windows)
    restore_windows_stock
    ;;
  *)
    echo "usage: $0 [--install-adaptive|--install-adaptive-windows|--restore-stock|--restore-stock-windows]" >&2
    exit 2
    ;;
esac
