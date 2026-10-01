#!/usr/bin/env bash
# list unpushed commits / uncommitted changes in every slot checkout
B=/workspace/w1-codex
for gd in $B/gd/*; do k=$(basename $gd); wt=$B/wt/$k
  export GIT_DIR=$gd GIT_WORK_TREE=$wt
  ch=$(git status --porcelain 2>/dev/null | grep -v -E 'SESSION_STATE.md|^\?\? (target|node_modules)/' | wc -l)
  cur=$(git branch --show-current)
  un=""
  for br in $(git for-each-ref --format='%(refname:short)' refs/heads/); do
    n=$(git rev-list --count $br --not --remotes=origin 2>/dev/null)
    [ "${n:-0}" -gt 0 ] && un="$un $br($n)"
  done
  [ "$ch" -gt 0 -o -n "$un" ] && echo "$k: cur=$cur uncommitted=$ch unpushed:$un"
done
unset GIT_DIR GIT_WORK_TREE
