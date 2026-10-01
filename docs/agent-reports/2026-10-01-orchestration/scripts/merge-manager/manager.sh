#!/bin/bash
# Slot manager (strict kept, no merge queue). Keeps auto-merge ON for at most $SLOTS PRs from queue.txt (in order),
# OFF for other open auto-merge PRs. Updates BEHIND actives, auto-rebases DECISIONS-only DIRTY ones, reruns a failed
# ci-gate once, then skips. Stop: touch /tmp/manager.stop
R=raydocs/tono; W=/workspace/merge-work; SLOTS=${SLOTS:-3}; B=$W/bin
touch $W/skip.txt $W/manual.txt $W/rerun.txt $W/disabled.txt
log(){ echo "$(date +%T) $*"; }
while [ ! -f /tmp/manager.stop ]; do
  [ -f $W/slots ] && SLOTS=$(cat $W/slots)
  data=$(gh pr list -R $R --state open --limit 200 --json number,mergeStateStatus,headRefOid,autoMergeRequest,isDraft,baseRefName,statusCheckRollup \
    -q '.[]|"\(.number) \(.mergeStateStatus) \(.headRefOid) \(.autoMergeRequest!=null) \(.isDraft) \(.baseRefName) \([.statusCheckRollup[]|select(.name=="ci-gate")|"\(.status)/\(.conclusion)"]|first // "none") \([.statusCheckRollup[]|select(.conclusion=="FAILURE")|.detailsUrl]|first // "-")"' 2>/dev/null)
  [ -z "$data" ] && { sleep 60; continue; }
  active=()
  for n in $(cat $W/queue.txt); do
    line=$(echo "$data" | awk -v n=$n '$1==n'); [ -z "$line" ] && continue
    grep -qx $n $W/skip.txt $W/manual.txt && continue
    read _ st h auto draft base gate furl <<< "$line"
    [ "$base" != main ] && continue
    if [ "$st" = DIRTY ]; then
      log "#$n DIRTY -> trying DECISIONS-only rebase"
      out=$($B/rebase.sh $n 2>&1); rc=$?
      if [ $rc = 0 ]; then p=$($B/push.sh $n 2>&1); log "#$n rebased+push: $(echo $p | tail -c 150)"
      else
        bo=$($B/bumphelper.sh $n 2>&1); brc=$?
        if [ $brc = 0 ] && echo "$bo" | grep -q "^OK bump-"; then
          read bbr bhead < /tmp/bump-$n.head
          pr=$(cd $W/wt && git push origin bump-$n:refs/heads/$bbr 2>&1 | tail -1); log "#$n helper bump: $(echo "$bo" | grep '^main=\|^OK') push: $pr"
        else log "#$n needs manual rebase: $(echo $out | tail -c 150) / bump: $(echo $bo | tail -c 150)"; echo $n >> $W/manual.txt; continue; fi
      fi
    fi
    if [[ "$gate" == COMPLETED/FAILURE* ]]; then
      if ! grep -qx "$n:$h" $W/rerun.txt; then
        run=$(echo "$furl" | sed -n 's#.*/runs/\([0-9]*\)/.*#\1#p'); echo "$n:$h" >> $W/rerun.txt
        [ -n "$run" ] && { gh run rerun $run -R $R --failed >/dev/null 2>&1; log "#$n ci-gate failed on ${h:0:8}; reran failed jobs of run $run"; }
      else log "#$n ci-gate failed twice on ${h:0:8}; skipping"; echo $n >> $W/skip.txt; continue; fi
    fi
    active+=($n)
    [ "$draft" = true ] && { gh pr ready $n -R $R >/dev/null 2>&1 && log "#$n marked ready"; }
    [ "$auto" = false ] && { gh pr merge $n -R $R --auto --merge >/dev/null 2>&1 && log "#$n auto-merge ON"; }
    [ "$st" = BEHIND ] && { gh api -X PUT repos/$R/pulls/$n/update-branch -f update_method=merge -f expected_head_sha=$h >/dev/null 2>&1 && log "#$n updated"; }
    [ ${#active[@]} -ge $SLOTS ] && break
  done
  echo "${active[*]}" > $W/active.txt
  for n in $(echo "$data" | awk '$4=="true"{print $1}'); do
    [[ " ${active[*]} " == *" $n "* ]] && continue
    gh pr merge $n -R $R --disable-auto >/dev/null 2>&1 && { log "#$n auto-merge OFF (not in active slots)"; grep -qx $n $W/disabled.txt || echo $n >> $W/disabled.txt; }
  done
  sleep 90
done
