#!/bin/bash
# block up to $1 min until main moves or manager logs a non-routine line
W=/workspace/merge-work; m0=$(git -C $W/tono ls-remote origin refs/heads/main | cut -c1-8); l0=$(wc -l < $W/manager.log)
end=$(( $(date +%s) + $1*60 ))
while [ $(date +%s) -lt $end ]; do
  sleep 45
  m=$(git -C $W/tono ls-remote origin refs/heads/main | cut -c1-8)
  new=$(tail -n +$((l0+1)) $W/manager.log | grep -E "DIRTY|manual|failed|skipping|bump|rebased")
  if [ "$m" != "$m0" ] || [ -n "$new" ]; then break; fi
done
echo "main $m0 -> $m"; tail -n +$((l0+1)) $W/manager.log | grep -v "auto-merge OFF"; echo "active: $(cat $W/active.txt)"; date +%T
