#!/bin/zsh
set -euo pipefail

# Records Tono Core identity and a machine-checkable benchmark matrix.
# Network impairment legs require `tc`/`dnctl` and are skipped when absent.
# This script never retunes gVisor buffers.

repo_root=${0:A:h:h:h}
mac_core="$repo_root/apps/macos/Tono/Resources/mihomo"
win_core="$repo_root/apps/windows/app/src-tauri/sidecar/tono-core-x86_64-pc-windows-msvc.exe"
out_dir="${1:-$repo_root/docs/reports}"
stamp=$(/bin/date -u '+%Y%m%dT%H%M%SZ')
report="$out_dir/CORE_BENCH_$stamp.md"

mkdir -p "$out_dir"

{
  echo "# Tono Core benchmark snapshot"
  echo
  echo "Generated: $stamp"
  echo
  echo "## Identity"
  if [[ -x $mac_core ]]; then
    echo
    echo "### macOS sidecar"
    echo
    echo '```'
    /usr/bin/file "$mac_core"
    /bin/ls -lh "$mac_core"
    "$mac_core" -v || true
    echo '```'
  fi
  if [[ -f $win_core ]]; then
    echo
    echo "### Windows sidecar"
    echo
    echo '```'
    /bin/ls -lh "$win_core"
    /usr/bin/file "$win_core" || true
    echo '```'
  fi
  echo
  echo "## Required matrix (not guessed)"
  echo
  echo "| RTT | Loss | Rate | Pattern | Status |"
  echo "| --- | --- | --- | --- | --- |"
  for rtt in 50 200 500 800; do
    for loss in 0 1 3 5; do
      for rate in 10 100 500; do
        echo "| ${rtt}ms | ${loss}% | ${rate}Mbps | tcp-single | not-run |"
      done
    done
  done
  echo
  echo "Additional legs (not-run): small-object TTFB, 32-conn multiplex, long-lived 5 min, QUIC vs TCP, idle/connect CPU, peak/stable RSS, Reality handshake, TUN first packet, DNS first vs cache."
  echo
  if ! command -v tc >/dev/null && ! command -v dnctl >/dev/null; then
    echo "Impairment tools unavailable on this host. Matrix left as not-run rather than inventing numbers."
  fi
} > "$report"

echo "$report"
