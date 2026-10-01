#!/bin/bash
# usage: ratchet-check.sh <pr>  -> merges PR head with origin/main in wt (detached), prints counts and new errors vs main
export PATH=/workspace/tools/node22/bin:$PATH
n=$1; cd /workspace/merge-work/wt2
git fetch -q origin main +pull/$n/head:refs/pr/$n || exit 2
git checkout -q --detach refs/pr/$n && git merge -q --no-edit origin/main >/dev/null 2>&1 || { echo "#$n CONFLICT: $(git diff --name-only --diff-filter=U | tr '\n' ' ')"; git merge --abort; git checkout -q --detach origin/main; exit 3; }
run(){ (cd $1 && ./node_modules/.bin/tsc $2 --noEmit --pretty false --incremental false --noUncheckedIndexedAccess 2>&1 | grep 'error TS'); }
for spec in "apps/windows/app||apps/windows/app/unchecked-index.baseline" "services/ops-console||services/ops-console/unchecked-index.baseline" "services/control-plane||services/control-plane/unchecked-index.baseline" "services/control-plane|-p admin/tsconfig.json|services/control-plane/admin/unchecked-index.baseline"; do
  IFS='|' read d a b <<< "$spec"
  c=$(run $d "$a" | wc -l); base=$(grep -v '^#' $b | head -1)
  if [ "$c" -gt "$base" ]; then echo "#$n $d $a: $c > $base"; run $d "$a" | sed "s#^#   $d/#" ; fi
done
echo "#$n strict: $(for d in apps/windows/app services/ops-console services/control-plane; do (cd $d && ./node_modules/.bin/tsc --noEmit --pretty false 2>&1 | grep -c 'error TS'); done | tr '\n' ' ')"
git checkout -q --detach origin/main
