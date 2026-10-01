#!/bin/bash
# Wait for #1079 to merge, then trigger the unsigned Windows candidate on main once.
for i in $(seq 1 120); do
  s=$(gh pr view 1079 -R raydocs/tono --json state -q .state 2>/dev/null)
  if [ "$s" = "MERGED" ]; then
    sleep 30
    gh workflow run windows-candidate.yml -R raydocs/tono --ref main && echo "triggered $(date)" 
    sleep 20
    gh run list -R raydocs/tono --workflow windows-candidate.yml --limit 1 --json databaseId,url,headSha
    exit 0
  fi
  [ "$s" = "CLOSED" ] && { echo "1079 closed"; exit 1; }
  sleep 120
done
echo timeout
