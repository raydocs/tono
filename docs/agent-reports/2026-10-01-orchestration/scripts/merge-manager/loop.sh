#!/bin/bash
# run up to $1 minutes: sweep every 10 min (state in /tmp/lastsweep); report on any batch PR merge/fail/dirty. Batch PRs = rest args.
max=$1; shift
end=$(( $(date +%s) + max*60 ))
while [ $(date +%s) -lt $end ]; do
  now=$(date +%s); last=$(cat /tmp/lastsweep 2>/dev/null || echo 0)
  if [ $((now-last)) -ge 600 ]; then echo "$now" > /tmp/lastsweep; /workspace/merge-work/bin/sweep.sh | grep -v "UNKNOWN\|BLOCKED\|CLEAN"; fi
  out=$(/workspace/merge-work/bin/st.sh "$@")
  if echo "$out" | grep -qE "MERGED|fails=[^ ]|DIRTY|CLOSED"; then echo "$out"; date; exit 0; fi
  if echo "$out" | grep -q BEHIND; then for p in $(echo "$out" | awk '/BEHIND/{print substr($1,2)}'); do h=$(gh pr view $p -R raydocs/tono --json headRefOid -q .headRefOid); gh api -X PUT repos/raydocs/tono/pulls/$p/update-branch -f update_method=merge -f expected_head_sha=$h >/dev/null 2>&1 && echo "updated #$p $(date +%T)"; done; fi
  sleep 60
done
echo "$out"; date
