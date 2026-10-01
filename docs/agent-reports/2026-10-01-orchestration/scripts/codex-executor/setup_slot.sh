#!/usr/bin/env bash
# Usage: setup_slot.sh SLOT BRANCHBASE -> gitdir /workspace/w1-codex/gd/SLOT, worktree /workspace/w1-codex/wt/SLOT (no .git pointer; use GIT_DIR/GIT_WORK_TREE)
set -euo pipefail
S=$1; BR=$2; B=/workspace/w1-codex
GD=$B/gd/$S; WT=$B/wt/$S
[ -e $GD ] && { echo "exists"; exit 1; }
git clone -q --no-checkout --separate-git-dir=$GD /workspace/w1-codex/repo $WT
rm -f $WT/.git
export GIT_DIR=$GD GIT_WORK_TREE=$WT
git remote set-url origin https://github.com/raydocs/tono.git
git config user.name raydocs
git config user.email 139067258+raydocs@users.noreply.github.com
git config credential.helper ''
git config --add credential.helper '!gh auth git-credential'
git fetch -q origin '+refs/heads/main:refs/remotes/origin/main'
cd $WT && git checkout -q -B $BR origin/main
git log -1 --format='%h %s'
