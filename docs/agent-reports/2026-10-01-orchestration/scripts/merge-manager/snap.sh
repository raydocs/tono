#!/bin/bash
# Every 5 min: when the latest ci-gate run on ci/main-snapshot is done, log its result and dispatch a new one on current main.
R=raydocs/tono; W=/workspace/merge-work
while [ ! -f /tmp/snap.stop ]; do
  read id sha st concl < <(gh run list -R $R --workflow ci-gate.yml --branch ci/main-snapshot --limit 1 --json databaseId,headSha,status,conclusion -q '.[0]|"\(.databaseId) \(.headSha[:8]) \(.status) \(.conclusion // "-")"')
  if [ "$st" = completed ]; then
    if ! grep -q "^$id " $W/snapshots.log 2>/dev/null; then
      bad=$(gh run view $id -R $R --json jobs -q '[.jobs[]|select(.conclusion=="failure" or .conclusion=="timed_out")|.name]|join(", ")')
      echo "$id $sha $concl $(date +%T) ${bad}" >> $W/snapshots.log
      [ "$concl" != success ] && echo "$(date +%T) SNAPSHOT-FAIL $sha run $id: $bad" >> $W/mgr2.log
    fi
    git -C $W/tono fetch -q origin main
    new=$(git -C $W/tono rev-parse --short=8 origin/main)
    if [ "$new" != "$sha" ]; then
      git -C $W/tono push -q -f origin origin/main:refs/heads/ci/main-snapshot 2>/dev/null && gh workflow run ci-gate.yml -R $R --ref ci/main-snapshot && echo "$(date +%T) dispatched snapshot on $new"
    fi
  fi
  sleep 300
done
