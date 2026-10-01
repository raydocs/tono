#!/bin/bash
# push work-$p with lease against the fetched head; re-check remote head first
p=$1; cd /workspace/merge-work/tono
br=$(gh pr view $p -R raydocs/tono --json headRefName -q .headRefName)
fetched=$(awk '{print $3}' /tmp/rebase-$p.head)
remote=$(git ls-remote origin refs/heads/$br | cut -f1)
[ "$remote" != "$fetched" ] && { echo "BRANCH MOVED: remote=$remote fetched=$fetched"; exit 5; }
git push --force-with-lease=refs/heads/$br:$fetched origin work-$p:refs/heads/$br 2>&1 | tail -2
