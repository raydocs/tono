#!/usr/bin/env bash
# quick monitor of codex slot runs
cd /workspace/w1-codex
python3 /workspace/sol2-bughunt/quota.py
for d in runs/[WR][0-9]-*; do
  k=$(basename $d); [ -s $d/stream.jsonl ] || continue
  alive=$(pgrep -f "wt/$k " >/dev/null && echo RUN || echo done)
  last=$(tail -1 $d/stream.jsonl | python3 -c 'import sys,json
try:
  e=json.loads(sys.stdin.read()); it=e.get("item",{}); print(e.get("type"), it.get("type",""), (it.get("command") or it.get("text") or "")[:160].replace("\n"," "))
except Exception as x: print("?")')
  echo "$k [$alive] ev=$(wc -l < $d/stream.jsonl) prs=$(wc -l < out/$k/prs.tsv 2>/dev/null) find=$(wc -l < out/$k/findings.tsv 2>/dev/null) | $last"
done
tail -3 ledger.log
