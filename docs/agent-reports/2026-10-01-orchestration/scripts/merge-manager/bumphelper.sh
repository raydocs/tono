#!/bin/bash
# Merge origin/main into PR $1's branch (no force push), resolving only HelperProtocolVersion/CONTRACT (helper = main+0.0.1)
# and DECISIONS.md (main first). Prints result; push with: git push origin bump-$1:refs/heads/<branch>
set -u; p=$1; W=/workspace/merge-work; cd $W/wt
git merge --abort >/dev/null 2>&1; git rebase --abort >/dev/null 2>&1
git fetch -q origin main "+refs/pull/$p/head:refs/pr/$p" || exit 2
br=$(gh pr view $p -R raydocs/tono --json headRefName -q .headRefName); head=$(git rev-parse refs/pr/$p); echo "$br $head" > /tmp/bump-$p.head
git checkout -q -B bump-$p $head
HV=apps/macos/Tono/Core/HelperProtocolVersion.swift; CT=tooling/scripts/core-helper/CONTRACT.sha256
git -c merge.conflictStyle=merge merge --no-ff --no-edit origin/main >/tmp/bump-$p.log 2>&1
un=$(git diff --name-only --diff-filter=U)
for f in $un; do case $f in $HV|$CT|docs/DECISIONS.md) ;; *) echo "NON-HELPER CONFLICT: $f"; git merge --abort; exit 3;; esac; done
mainver=$(git show origin/main:$HV | sed -n 's/.*static let current = "\([^"]*\)".*/\1/p')
prver=$(git show $head:$HV | sed -n 's/.*static let current = "\([^"]*\)".*/\1/p')
basever=$(git show $(git merge-base origin/main $head):$HV | sed -n 's/.*static let current = "\([^"]*\)".*/\1/p')
if [ "$prver" = "$basever" ]; then echo "PR does not bump helper; nothing special"; fi
newver=$(echo $mainver | awk -F. '{print $1"."$2"."$3+1}')
echo "main=$mainver pr=$prver base=$basever -> new=$newver"
if echo "$un" | grep -q "docs/DECISIONS.md"; then python3 - <<'PY'
s=open('docs/DECISIONS.md').read().split('\n'); out=[]; i=0
while i<len(s):
    if s[i].startswith('<<<<<<< '):
        a=[];b=[];i+=1
        while not s[i].startswith('======='): a.append(s[i]); i+=1
        i+=1
        while not s[i].startswith('>>>>>>> '): b.append(s[i]); i+=1
        i+=1
        # merge: a=ours(PR), b=theirs(main) -> main first
        while b and b[-1]=='': b.pop()
        while a and a[0]=='': a.pop(0)
        out+= b + ([''] if a and b else []) + a
    else: out.append(s[i]); i+=1
open('docs/DECISIONS.md','w').write('\n'.join(out))
PY
git add docs/DECISIONS.md; fi
if [ "$prver" != "$basever" ]; then
  git show $head:$HV > /tmp/pr-hv.swift; git show origin/main:$HV > $HV
  python3 - "$prver" "$basever" "$mainver" "$newver" <<'PY'
import sys,re
prver,basever,mainver,newver=sys.argv[1:]
pr=open('/tmp/pr-hv.swift').read().split('\n'); p='apps/macos/Tono/Core/HelperProtocolVersion.swift'
m=open(p).read().split('\n')
ci=[i for i,l in enumerate(pr) if 'static let current = ' in l][0]
si=[i for i,l in enumerate(pr[:ci]) if re.search(r'/// - \S+ → '+re.escape(prver)+':',l)][-1]
block=pr[si:ci]; block[0]=re.sub(r'- \S+ → '+re.escape(prver)+':','- '+mainver+' → '+newver+':',block[0])
mi=[i for i,l in enumerate(m) if 'static let current = ' in l][0]
m[mi]=m[mi].replace('"'+mainver+'"','"'+newver+'"')
m=m[:mi]+block+m[mi:]
open(p,'w').write('\n'.join(m))
PY
  echo "$newver $($W/bin/helperhash.sh .)" > $CT
  git add $HV $CT
fi
if git diff --name-only --diff-filter=U | grep -q .; then echo "unresolved remain"; git merge --abort; exit 4; fi
grep -rn '^<<<<<<<\|^>>>>>>>' $HV $CT docs/DECISIONS.md && { echo markers; git merge --abort; exit 4; }
git commit -q --no-edit -m "Merge main into $br; helper $newver" && echo "OK bump-$p $(git rev-parse --short HEAD) helper=$newver"
git diff origin/main..HEAD -- $HV $CT | grep '^[+-]' | grep -v '^+++\|^---'
