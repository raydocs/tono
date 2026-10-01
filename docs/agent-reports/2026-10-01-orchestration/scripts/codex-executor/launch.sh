#!/usr/bin/env bash
# Usage: launch.sh WAVE SLOT BRANCH0   (e.g. W1 grok-win-wfp hunt/grok-wfp-hunt)
set -u
W=$1; S=$2; BR0=$3; B=/workspace/w1-codex; O=/workspace/orchestrator
mkdir -p $O/claims
if ! mkdir $O/claims/$W-$S 2>/dev/null; then
  { [ "${RELAUNCH:-}" = 1 ] && grep -q "executor (Codex account 2)" $O/claims/$W-$S/owner 2>/dev/null; } || { echo "$W-$S already claimed"; exit 3; }
fi
[ "${RELAUNCH:-}" = 1 ] || echo "claimed by executor (Codex account 2) $(date '+%F %T %Z')" > $O/claims/$W-$S/owner
KEY=$W-$S; GD=$B/gd/$KEY; WT=$B/wt/$KEY; OUT=$B/out/$KEY; R=$B/runs/$KEY
[ -d $R ] && [ -s $R/stream.jsonl ] && mv $R $B/runs/_aborted/$KEY-$(date +%H%M)
mkdir -p $OUT $R
[ -d $GD ] || $B/setup_slot.sh $KEY $BR0 > $R/setup.log 2>&1 || { echo "setup failed"; cat $R/setup.log; exit 4; }
{ P=$B/prompt-overrides/full_$W-$S.md; [ -f $P ] || P=$O/prompts/full_$W-$S.md; cat $P; sed -e "s#__WT__#$WT#g; s#__GD__#$GD#g; s#__BRANCH0__#$BR0#g; s#__OUT__#$OUT#g; s#__START__#$(date '+%-I:%M %p')#g" $B/addendum.md; [ -f $B/hints/$S.md ] && cat $B/hints/$S.md; if [ -s $OUT/findings.tsv ]; then echo; echo "## CONTINUATION: a previous run of this slot was cut off (a transient content-filter error). Already examined (do not redo; findings.tsv and prs.tsv in __OUT__ are yours, keep appending):"; cat $OUT/findings.tsv; echo; echo "PRs already opened by the previous run (check their CI with gh pr checks, fix only your own if red):"; cat $OUT/prs.tsv; fi | sed "s#__OUT__#$OUT#g"; } > $R/prompt.md
touch $OUT/prs.tsv $OUT/findings.tsv
EFFORT=${EFFORT:-ultra}
echo "$KEY start $(date '+%F %T') effort=$EFFORT" >> $B/ledger.log
cd $WT
export GIT_DIR=$GD GIT_WORK_TREE=$WT CARGO_BUILD_JOBS=2
T0=$(date +%s)
CODEX_HOME=/home/box/.codex-2 /home/box/.local/bin/codex exec --skip-git-repo-check --enable multi_agent_v2 -m gpt-6.1-sol \
  -c model_reasoning_effort=$EFFORT -c project_doc_max_bytes=0 \
  -s workspace-write -c sandbox_workspace_write.network_access=true \
  -c "sandbox_workspace_write.writable_roots=[\"$GD\",\"$OUT\",\"/home/box/.cargo\",\"/home/box/.npm\",\"/home/box/.cache\"]" \
  -C $WT --json -o $R/final.md - < $R/prompt.md > $R/stream.jsonl 2> $R/stderr.log
RC=$?
USAGE=$(grep '"turn.completed"' $R/stream.jsonl | tail -1)
echo "$KEY end $(date '+%F %T') rc=$RC wall=$(( $(date +%s)-T0 ))s $USAGE" >> $B/ledger.log
