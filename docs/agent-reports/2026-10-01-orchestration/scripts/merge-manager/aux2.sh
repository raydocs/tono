#!/bin/bash
# every 2 min: queue new auto-merge-requested non-UI PRs; retarget stacked PRs whose base merged; every ~6 min run labeler.
R=raydocs/tono; W=/workspace/merge-work; k=0
UI=" 713 716 717 719 721 723 726 731 735 737 739 743 745 746 747 748 734 724 725 691 694 663 204 203 805 "
while [ ! -f /tmp/aux2.stop ]; do
  uil=" $(gh pr list -R $R --state open --label ui-review --limit 200 --json number -q '.[].number' | tr '\n' ' ') "
  for n in $(cat $W/disabled.txt); do grep -qx $n $W/queue.txt && continue; [[ "$UI$uil" == *" $n "* ]] && continue; echo $n >> $W/queue.txt; echo "$(date +%T) queued #$n"; done
  for n in 742 715 718; do
    b=$(gh pr view $n -R $R --json baseRefName,state -q 'select(.state=="OPEN")|.baseRefName' 2>/dev/null)
    [ -z "$b" ] || [ "$b" = main ] && continue
    st=$(gh pr list -R $R --head "$b" --state all --json state -q '.[0].state' 2>/dev/null)
    [ "$st" = MERGED ] && gh api -X PATCH repos/$R/pulls/$n -f base=main --jq .base.ref >/dev/null 2>&1 && echo "$(date +%T) retargeted #$n to main (base $b merged)"
  done
  [ $((k % 3)) = 0 ] && python3 $W/bin/classify.py apply 2>&1 | grep label
  k=$((k+1)); sleep 120
done
