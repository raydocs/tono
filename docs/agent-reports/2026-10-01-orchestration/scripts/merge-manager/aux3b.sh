#!/bin/bash
# every 2 min: queue new auto-merge-requested PRs (all but telemetry/excluded); retarget ANY stacked PR whose base PR merged; every ~6 min run labeler.
R=raydocs/tono; W=/workspace/merge-work; k=0
EX=" 724 725 691 694 663 204 203 "
while [ ! -f /tmp/aux2.stop ]; do
  for n in $(cat $W/disabled.txt); do grep -qx $n $W/queue.txt && continue; [[ "$EX" == *" $n "* ]] && continue; echo $n >> $W/queue.txt; echo "$(date +%T) queued #$n"; done
  gh pr list -R $R --state open --limit 250 --json number,baseRefName -q '.[]|select(.baseRefName!="main" and (.baseRefName|startswith("release/")|not))|"\(.number) \(.baseRefName)"' | while read n b; do
    [[ "$EX" == *" $n "* ]] && continue
    st=$(gh pr list -R $R --head "$b" --state all --json state -q '.[0].state' 2>/dev/null)
    [ "$st" = MERGED ] && gh api -X PATCH repos/$R/pulls/$n -f base=main --jq .base.ref >/dev/null 2>&1 && { echo "$(date +%T) retargeted #$n to main (base $b merged)"; sleep 5; echo "$(date +%T) #$n update-branch: $(gh api -X PUT repos/$R/pulls/$n/update-branch -f update_method=merge --jq .message 2>&1 | tail -1)"; }
  done
  [ $((k % 3)) = 0 ] && python3 $W/bin/classify.py apply 2>&1 | grep label
  k=$((k+1)); sleep 120
done
