#!/bin/bash
# every 2 min: append new non-UI PRs (seen in disabled.txt) to queue; retarget stacked PRs whose base PR merged.
R=raydocs/tono; W=/workspace/merge-work
UI=" 713 716 717 719 721 723 726 731 735 737 739 743 745 746 747 748 734 724 725 691 694 663 204 203 805 "
while [ ! -f /tmp/aux.stop ]; do
  for n in $(cat $W/disabled.txt); do grep -qx $n $W/queue.txt || { [[ "$UI" == *" $n "* ]] || { echo $n >> $W/queue.txt; echo "$(date +%T) queued #$n"; }; }; done
  for n in 742 715 718; do
    b=$(gh pr view $n -R $R --json baseRefName,state -q 'select(.state=="OPEN")|.baseRefName' 2>/dev/null)
    [ -z "$b" ] || [ "$b" = main ] && continue
    st=$(gh pr list -R $R --head "$b" --state all --json state -q '.[0].state' 2>/dev/null)
    if [ "$st" = MERGED ]; then gh api -X PATCH repos/$R/pulls/$n -f base=main --jq .base.ref >/dev/null 2>&1 && echo "$(date +%T) retargeted #$n to main (base $b merged)"; fi
  done
  sleep 120
done
