#!/usr/bin/env bash
# usage: fetch-evidence.sh <run id> <out dir>: downloads both emulator halves and merges their primary evidence
set -euo pipefail
RUN="$1"; OUT="$2"; rm -rf "$OUT"; mkdir -p "$OUT"
for shard in system ui; do
  gh run download "$RUN" --repo raydocs/tono -n "android-emulator-evidence-$shard" -D "$OUT/$shard"
done
mkdir -p "$OUT/evidence"
for shard in system ui; do
  ( cd "$OUT/$shard/evidence" && find . -type f ! -name summary.txt ! -name logcat.txt ! -name logcat-live.txt ! -name device.txt ! -path './host/*' -print0 | xargs -0 -I{} cp --parents {} "../../evidence/" )
  sed "s/^/[$shard] /" "$OUT/$shard/evidence/summary.txt" >> "$OUT/evidence/summary.txt"
done
grep -c PASS "$OUT/evidence/summary.txt" | sed 's/^/PASS total: /'
grep -v PASS "$OUT/evidence/summary.txt" || true
