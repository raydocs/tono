#!/bin/bash
# rebase PR onto origin/main resolving only docs/DECISIONS.md (main first, then PR). Does NOT push.
set -u
p=$1; base=${2:-origin/main}; cd /workspace/merge-work/tono
git rebase --abort >/dev/null 2>&1
git fetch -q origin main "+refs/pull/$p/head:refs/pr/$p" || exit 2
head=$(git rev-parse refs/pr/$p); echo "fetched head $head" > /tmp/rebase-$p.head
git checkout -q -B work-$p $head
git -c merge.conflictStyle=merge rebase $base >/tmp/rebase-$p.log 2>&1
while [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; do
  files=$(git diff --name-only --diff-filter=U)
  [ -z "$files" ] && { GIT_EDITOR=true git rebase --continue >>/tmp/rebase-$p.log 2>&1 || true; continue; }
  if [ "$files" != "docs/DECISIONS.md" ]; then echo "NON-DECISIONS CONFLICT: $files"; git rebase --abort; exit 3; fi
  python3 - <<'PY'
import re
s=open('docs/DECISIONS.md').read()
out=[];i=0;L=s.split('\n')
while i<len(L):
    if L[i].startswith('<<<<<<< '):
        a=[];b=[];i+=1
        while not L[i].startswith('======='): a.append(L[i]);i+=1
        i+=1
        while not L[i].startswith('>>>>>>> '): b.append(L[i]);i+=1
        i+=1
        # strip trailing blanks, join with one blank line
        while a and a[-1]=='' : a.pop()
        while b and b[0]=='' : b.pop(0)
        out+= a + ([''] if a and b else []) + b
    else:
        out.append(L[i]);i+=1
open('docs/DECISIONS.md','w').write('\n'.join(out))
PY
  grep -q '^<<<<<<<\|^>>>>>>>' docs/DECISIONS.md && { echo "markers remain"; git rebase --abort; exit 4; }
  git add docs/DECISIONS.md
  GIT_EDITOR=true git rebase --continue >>/tmp/rebase-$p.log 2>&1 || true
done
echo "REBASED #$p: $(git rev-parse --short HEAD) onto $(git rev-parse --short $base); from $head"
git diff --stat $base..HEAD | tail -1
