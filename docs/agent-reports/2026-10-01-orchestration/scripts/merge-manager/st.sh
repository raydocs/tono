#!/bin/bash
# status of batch PRs
for p in "$@"; do
gh pr view $p -R raydocs/tono --json state,headRefOid,mergeStateStatus,isDraft,autoMergeRequest,statusCheckRollup,mergeCommit -q "\"#$p \(.state) \(.headRefOid[0:8]) \(.mergeStateStatus) draft=\(.isDraft) auto=\(.autoMergeRequest!=null) gate=\([.statusCheckRollup[]|select(.name==\"ci-gate\")|\"\(.status)/\(.conclusion)\"]|join(\",\")) fails=\([.statusCheckRollup[]|select(.conclusion==\"FAILURE\" or .conclusion==\"CANCELLED\")|.name]|join(\",\")) merge=\(.mergeCommit.oid // \"\")\""
done
