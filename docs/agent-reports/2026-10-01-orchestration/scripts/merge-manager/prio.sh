#!/bin/bash
# Priority sweep loop. Runs until killed. Heavy PRs (touch apps/macos, apps/windows, core-helper) with auto-merge:
# update immediately when BEHIND. Light PRs: update only every 10 min and only when no heavy auto-merge PR is BEHIND or pending.
# Disabled by touching /tmp/prio.stop
R=raydocs/tono; C=/workspace/merge-work/cache; last_light=0
heavy() { f=$C/heavy-$1; [ -f $f ] || { gh pr view $1 -R $R --json files -q '[.files[].path|select(test("^(apps/macos|apps/windows|tooling/scripts/core-helper)"))]|length>0' > $f 2>/dev/null || return 1; }; [ "$(cat $f)" = true ]; }
upd() { r=$(gh api -X PUT repos/$R/pulls/$1/update-branch -f update_method=merge -f expected_head_sha=$2 2>&1 | head -c 160); echo "$(date +%T) update #$1 ($3): $r"; }
while [ ! -f /tmp/prio.stop ]; do
  lst=$(gh pr list -R $R --state open --limit 200 --json number,autoMergeRequest,mergeStateStatus,headRefOid,statusCheckRollup \
    -q '.[]|select(.autoMergeRequest!=null)|"\(.number) \(.mergeStateStatus) \(.headRefOid) \([.statusCheckRollup[]|select(.name=="ci-gate")|.status]|join(","))"' 2>/dev/null)
  [ -z "$lst" ] && { sleep 60; continue; }
  busy=0; light=()
  while read n st h g; do
    if heavy $n; then
      case $st in BEHIND) upd $n $h heavy; busy=1;; DIRTY) echo "$(date +%T) #$n DIRTY (heavy)";; *) [ "$st" != CLEAN ] && busy=1;; esac
    else
      [ "$st" = BEHIND ] && light+=("$n:$h")
      [ "$st" = DIRTY ] && echo "$(date +%T) #$n DIRTY (light)"
    fi
  done <<< "$lst"
  now=$(date +%s)
  if [ $busy = 0 ] && [ $((now-last_light)) -ge 600 ] && [ ${#light[@]} -gt 0 ]; then
    last_light=$now; for x in "${light[@]}"; do upd ${x%%:*} ${x##*:} light; done
  fi
  sleep 90
done
