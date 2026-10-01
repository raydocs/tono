#!/usr/bin/env bash
# audit codex PRs: labels, automerge, suspicious files
for n in $(cut -f1 /workspace/w1-codex/out/*/prs.tsv | grep -o '[0-9]\+' | sort -u); do
  gh pr view $n -R raydocs/tono --json number,state,isDraft,mergeStateStatus,labels,autoMergeRequest,files,baseRefName,headRefName,title --jq '"#\(.number) \(.state) draft=\(.isDraft) \(.mergeStateStatus) base=\(.baseRefName) automerge=\(.autoMergeRequest.mergeMethod // "none") labels=[\([.labels[].name]|join(","))] files=\(.files|length) bad=[\([.files[].path|select(test("DECISIONS.md|SESSION_STATE|\\.lock$|^/tmp"))]|join(","))] \(.headRefName)"'
done
