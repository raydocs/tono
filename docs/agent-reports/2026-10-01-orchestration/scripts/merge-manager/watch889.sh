#!/bin/bash
while true; do
  o=$(gh pr view 889 -R raydocs/tono --json state,mergeCommit,mergedAt -q '.state+" "+(.mergeCommit.oid // "-")+" "+(.mergedAt // "-")')
  case "$o" in MERGED*|CLOSED*) echo "$(date +%T) $o" > /workspace/merge-work/889-merged.txt; echo "$(date +%T) #889 $o"; exit 0;; esac
  sleep 45
done
