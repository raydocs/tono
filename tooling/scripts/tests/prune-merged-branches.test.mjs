// prune-merged-branches deletes things, so its selection is pinned against a
// real throwaway origin: only work already on main may go; an unmerged branch,
// an open PR's head, release/*, stability/*, a branch a workflow names and a
// dirty worktree must stay.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { deleteRemoteBranches, selectRemoteBranches, selectWorktrees } from '../prune-merged-branches.mjs'

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}
Object.assign(process.env, ENV)

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env: ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function commit(cwd, file) {
  writeFileSync(path.join(cwd, file), `${file}\n`)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', file)
  return git(cwd, 'rev-parse', 'HEAD')
}

/** origin.git plus a clone `work` with branches pushed in every state the script must tell apart. */
function withRepo(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'prune-merged-'))
  try {
    git(root, 'init', '-q', '--bare', 'origin.git')
    git(root, 'clone', '-q', 'origin.git', 'work')
    const work = path.join(root, 'work')
    commit(work, 'base')
    // A workflow on main that names a branch (as macos-release.yml names its CANDIDATE_REF).
    mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true })
    writeFileSync(path.join(work, '.github', 'workflows', 'release.yml'), 'env:\n  CANDIDATE_REF: refs/heads/pinned\n')
    git(work, 'add', '.github')
    git(work, 'commit', '-q', '-m', 'workflow')
    git(work, 'push', '-q', 'origin', 'main')
    const branch = (name, file) => {
      git(work, 'switch', '-q', '-c', name, 'main')
      const sha = commit(work, file)
      git(work, 'switch', '-q', 'main')
      return sha
    }
    branch('merged', 'merged')
    branch('dirty-merged', 'dirty')
    branch('pinned', 'pinned')
    const openSha = branch('open-head', 'open')
    git(work, 'merge', '-q', '--no-ff', '-m', 'merge', 'merged', 'dirty-merged', 'pinned', 'open-head')
    git(work, 'branch', '-q', 'release/macos', 'main~1')
    git(work, 'branch', '-q', 'stability/desktop-0.0.1', 'main~1')
    const unmergedSha = branch('unmerged', 'unmerged')
    const pushed = ['main', 'merged', 'dirty-merged', 'pinned', 'open-head', 'release/macos', 'stability/desktop-0.0.1', 'unmerged']
    git(work, 'push', '-q', 'origin', ...pushed)
    run({ root, work, openSha, unmergedSha })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('remote: only branches whose tip is on main are selected; unmerged, open-PR head, release/stability and workflow-named branches stay', () => {
  withRepo(({ work, openSha, unmergedSha }) => {
    const prs = {
      open: [{ number: 2, headRefName: 'open-head', baseRefName: 'main' }],
      // A merged PR record does not override commits that are not on main.
      merged: [{ number: 1, headRefName: 'unmerged', headRefOid: unmergedSha, isCrossRepository: false, mergeCommit: { oid: openSha } }],
    }
    const { remove, keep } = selectRemoteBranches({ cwd: work, prs })
    assert.deepEqual(remove.map((b) => b.name).sort(), ['dirty-merged', 'merged'])
    const kept = Object.fromEntries(keep.map((b) => [b.name, b.reason]))
    assert.equal(kept['open-head'], 'head of an open PR')
    assert.equal(kept.unmerged, 'commits not on main')
    assert.equal(kept['release/macos'], 'protected branch')
    assert.equal(kept['stability/desktop-0.0.1'], 'protected branch')
    assert.equal(kept.main, 'protected branch')
    assert.equal(kept.pinned, 'named in .github/workflows')
  })
})

test('remote --apply: a branch pushed to after it was listed is not deleted', () => {
  withRepo(({ work }) => {
    const { remove } = selectRemoteBranches({ cwd: work, prs: { open: [], merged: [] } })
    git(work, 'switch', '-q', 'merged')
    commit(work, 'late')
    git(work, 'push', '-q', 'origin', 'merged')
    const quiet = console.log
    console.log = () => {}
    const errors = console.error
    console.error = () => {}
    try {
      assert.equal(deleteRemoteBranches(work, 'origin', remove), 1)
    } finally {
      console.log = quiet
      console.error = errors
    }
    const heads = git(work, 'ls-remote', '--heads', 'origin').split('\n').map((l) => l.split('\trefs/heads/')[1])
    assert.ok(heads.includes('merged'))
    assert.ok(!heads.includes('dirty-merged'))
  })
})

test('worktrees: a merged clean worktree is selected; dirty or unmerged worktrees stay', () => {
  withRepo(({ root, work }) => {
    for (const name of ['merged', 'dirty-merged', 'unmerged']) git(work, 'worktree', 'add', '-q', path.join(root, `wt-${name}`), name)
    writeFileSync(path.join(root, 'wt-dirty-merged', 'scratch.txt'), 'untracked\n')
    const { remove, keep } = selectWorktrees({ cwd: work, minIdleHours: 0 })
    assert.deepEqual(remove.map((w) => w.branch), ['merged'])
    const kept = Object.fromEntries(keep.map((w) => [w.branch, w.reason]))
    assert.equal(kept['dirty-merged'], 'modified or untracked files')
    assert.equal(kept.unmerged, 'branch not merged into main')
    assert.equal(kept.main, 'main worktree')
  })
})
