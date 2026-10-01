#!/bin/bash
# For every open PR with auto-merge: BEHIND -> update-branch (merge main in). Report DIRTY.
gh pr list -R raydocs/tono --state open --limit 200 --json number,autoMergeRequest,mergeStateStatus,headRefOid,isDraft \
  -q '.[]|select(.autoMergeRequest!=null)|"\(.number) \(.mergeStateStatus) \(.headRefOid) \(.isDraft)"' | while read n st h d; do
  case $st in
    BEHIND|UNKNOWN) r=$(gh api -X PUT repos/raydocs/tono/pulls/$n/update-branch -f update_method=merge -f expected_head_sha=$h 2>&1 | head -c 200); echo "#$n $st -> $r" | grep -v "no new commits";;
    DIRTY) echo "#$n DIRTY (needs rebase)";;
    *) echo "#$n $st draft=$d";;
  esac
done
date
