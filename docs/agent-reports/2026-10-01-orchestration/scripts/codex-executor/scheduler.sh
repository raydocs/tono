#!/usr/bin/env bash
# keeps up to MAX codex slot runs alive from queue.txt while quota < CAP and before STOP time
B=/workspace/w1-codex; MAX=${MAX:-4}; CAP=${CAP:-97}; STOP=${STOP:-2215}
while true; do
  [ $(date +%H%M) -ge $STOP ] && { echo "$(date +%T) stop time reached"; break; }
  [ -s $B/queue.txt ] || { echo "$(date +%T) queue empty"; break; }
  RUNNING=$(ps -eo args | grep -cE "^node .*codex exec.*-C /workspace/w1-codex/wt/")
  Q=$(python3 /workspace/sol2-bughunt/quota.py --pct | cut -d. -f1)
  if [ "$Q" -ge "$CAP" ]; then echo "$(date +%T) quota $Q >= $CAP, not launching"; sleep 300; continue; fi
  if [ "$RUNNING" -lt "$MAX" ]; then
    LINE=$(head -1 $B/queue.txt); sed -i 1d $B/queue.txt
    set -- $LINE
    if [ "${4:-}" = relaunch ]; then echo "$(date +%T) relaunching $1-$2"; RELAUNCH=1 setsid nohup $B/launch.sh $1 $2 $3 > $B/runs/launch-$1-$2.out 2>&1 < /dev/null & sleep 20; continue; fi
    if [ -e /workspace/orchestrator/claims/$1-$2 ]; then echo "$(date +%T) $1-$2 already claimed, skip"; continue; fi
    echo "$(date +%T) launching $LINE (running=$RUNNING quota=$Q)"
    setsid nohup $B/launch.sh $1 $2 $3 > $B/runs/launch-$1-$2.out 2>&1 < /dev/null &
    sleep 20; continue
  fi
  sleep 60
done
