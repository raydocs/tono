#!/bin/sh
# Raise the three TCP limits that measurably bind a Tono exit, and nothing else.
# Runs on the exit, as root. No restart, no dropped sessions.
#
# Why these three and not the thirty-two a tuning script would set:
#
#   tcp_wmem[2] 4 MiB -> 16 MiB
#     The send ceiling, which is the direction an exit actually pushes. A
#     mainland-China client sits around 180 ms away, so the bandwidth-delay
#     product at 200 Mbit/s is 200e6 * 0.18 / 8 = 4.5 MB — already past a 4 MiB
#     ceiling. Above roughly 180 Mbit/s the buffer, not the line, is the limit.
#     16 MiB carries the same path to about 700 Mbit/s.
#
#   tcp_rmem[2] 6 MiB -> 16 MiB, rmem_max/wmem_max 208 KiB -> 16 MiB
#     The stock kernel values. TCP autotuning reads tcp_rmem, so this matters
#     less than the send side, but anything calling setsockopt is capped by
#     *mem_max.
#
#   tcp_slow_start_after_idle 1 -> 0
#     An idle connection re-enters slow start after one RTO. The workload here
#     is long-lived connections used in bursts, which is exactly the shape that
#     pays for this repeatedly.
#
# Deliberately NOT set: any qdisc or congestion control (already bbr+fq), any
# HTB/rate limiting (an exit should not cap itself at a number measured once),
# and initcwnd (these paths already retransmit 1.6-8.3%, and a larger initial
# burst on a lossy path makes that worse, not better).
#
# Idempotent: a host already carrying this exact drop-in is left alone.

set -eu

DROPIN=/etc/sysctl.d/99-tono-tcp.conf
PREV=/etc/sysctl.d/.99-tono-tcp.previous

fail() { echo "tune-tono-tcp: $1" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "must run as root"
command -v sysctl >/dev/null 2>&1 || fail "sysctl is required"

KEYS="net.ipv4.tcp_rmem net.ipv4.tcp_wmem net.core.rmem_max net.core.wmem_max net.ipv4.tcp_slow_start_after_idle"

if [ "${1:-}" = "--revert" ]; then
  [ -f "$PREV" ] || fail "no recorded previous values at $PREV"
  rm -f "$DROPIN"
  # Restore by value, then reload everything else from disk so nothing is left
  # half-applied if a later drop-in also sets one of these.
  while IFS='=' read -r k v; do
    [ -n "$k" ] || continue
    sysctl -qw "$k=$v" || fail "could not restore $k"
  done < "$PREV"
  sysctl --system >/dev/null 2>&1 || true
  echo "reverted to the values recorded before tuning"
  exit 0
fi

DESIRED="net.ipv4.tcp_rmem = 4096 131072 16777216
net.ipv4.tcp_wmem = 4096 16384 16777216
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_slow_start_after_idle = 0"

echo "before:"
for k in $KEYS; do printf '  %-38s %s\n' "$k" "$(sysctl -n "$k" | tr '\t' ' ')"; done

if [ -f "$DROPIN" ] && [ "$(cat "$DROPIN")" = "$DESIRED" ]; then
  echo "already tuned; leaving this host alone"
  exit 0
fi

# Recorded once, so a re-run does not overwrite the true originals with the
# values this script just set.
if [ ! -f "$PREV" ]; then
  umask 077
  for k in $KEYS; do printf '%s=%s\n' "$k" "$(sysctl -n "$k" | tr '\t' ' ')"; done > "$PREV"
fi

umask 022
printf '%s\n' "$DESIRED" > "$DROPIN.new"
mv -f "$DROPIN.new" "$DROPIN"
sysctl -p "$DROPIN" >/dev/null || fail "sysctl refused the drop-in; $DROPIN is written but not applied"

# Applied is not the same as in effect: another drop-in later in the load order
# can win. Read the values back and refuse to report success if any did not take.
bad=""
for k in $KEYS; do
  want=$(printf '%s\n' "$DESIRED" | sed -n "s|^$k = ||p" | tr -s ' ')
  got=$(sysctl -n "$k" | tr '\t' ' ' | tr -s ' ')
  [ "$want" = "$got" ] || bad="$bad $k"
done
[ -z "$bad" ] || fail "these did not take effect (another drop-in may override them):$bad"

echo "after:"
for k in $KEYS; do printf '  %-38s %s\n' "$k" "$(sysctl -n "$k" | tr '\t' ' ')"; done
echo "tuned; previous values recorded at $PREV (revert with: $0 --revert)"
