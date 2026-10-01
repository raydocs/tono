#!/bin/bash
# wait up to $1 min for important mgr2 events; then print summary
W=/workspace/merge-work; l0=$(wc -l < $W/mgr2.log); end=$(( $(date +%s) + $1*60 ))
while [ $(date +%s) -lt $end ]; do sleep 30; tail -n +$((l0+1)) $W/mgr2.log | grep -qE "MAIN-FAIL|SNAPSHOT-FAIL|failed twice|manual|Traceback|retargeted" && break; done
tail -n +$((l0+1)) $W/mgr2.log | grep -vE "auto-merge ON$|docs: auto-merge OFF|UI: auto-merge OFF"
git -C $W/tono fetch -q origin main; echo "merged since 18:30: $(git -C $W/tono log --first-parent --since='2026-09-30 18:30' --format=%s origin/main | wc -l)  main=$(git -C $W/tono rev-parse --short origin/main)"; date +%T
