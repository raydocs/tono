#!/bin/bash
# wait until any PR merges or has failures/conflicts; max $1 minutes; rest are PR numbers
max=$1; shift
for i in $(seq 1 $((max*60/90))); do
  out=$(/workspace/merge-work/bin/st.sh "$@")
  if echo "$out" | grep -qE "MERGED|fails=[^ ]|DIRTY|BEHIND|CLOSED"; then echo "$out"; date; exit 0; fi
  sleep 90
done
echo "$out"; date
