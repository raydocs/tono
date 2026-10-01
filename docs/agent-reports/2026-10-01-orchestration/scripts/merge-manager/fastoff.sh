#!/bin/bash
# every 20s: disable auto-merge on any PR not in active.txt (fallback serialization). Stop: touch /tmp/fastoff.stop
R=raydocs/tono; W=/workspace/merge-work
while [ ! -f /tmp/fastoff.stop ]; do
  act=" $(cat $W/active.txt) "
  for n in $(gh pr list -R $R --state open --limit 200 --json number,autoMergeRequest -q '.[]|select(.autoMergeRequest!=null)|.number' 2>/dev/null); do
    [[ "$act" == *" $n "* ]] && continue
    gh pr merge $n -R $R --disable-auto >/dev/null 2>&1 && { echo "$(date +%T) #$n auto-merge OFF (fast)"; grep -qx $n $W/disabled.txt || echo $n >> $W/disabled.txt; }
  done
  sleep 20
done
