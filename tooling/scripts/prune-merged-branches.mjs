#!/usr/bin/env node
// Repo hygiene (backlog A26, decision D10-A): delete remote branches and remove
// local worktrees whose work is already on main. Dry-run is the default; only
// --apply changes anything.
//
//   remote     origin branches whose tip is an ancestor of origin/main, or is
//              the head SHA of a merged same-repo PR whose every patch is on
//              main (`git cherry` shows no `+`). Kept: main, release/*,
//              stability/* (release candidate lines), gh-readonly-queue/*
//              (merge queue), any branch named in
//              main's .github/workflows, the head or base of any open PR, a
//              tip equal to main (no work yet), and anything else with
//              commits not on main. Deletion pushes with
//              --force-with-lease=<ref>:<listed sha>, so a branch that moved
//              after it was listed stays.
//   worktrees  linked worktrees whose branch tip is an ancestor of origin/main
//              and whose working tree is clean (no modified, staged,
//              untracked or ignored files, no skip-worktree/assume-unchanged
//              entries). Kept: the main worktree, the current one,
//              locked, missing, detached, a branch at main's tip, and any
//              worktree touched in the last --min-idle-hours (default 24) so a
//              just-created agent worktree is not pulled from under it. Removal
//              is `git worktree remove` without --force; git refuses anything
//              dirty a second time.
//
// Usage:
//   node tooling/scripts/prune-merged-branches.mjs remote    [--dry-run|--apply] [--no-fetch] [--verbose]
//   node tooling/scripts/prune-merged-branches.mjs worktrees [--dry-run|--apply] [--no-fetch] [--min-idle-hours N] [--verbose]
// Options: --remote <name> (origin), --main <branch> (main), --prs-json <file>
// ({"open":[...],"merged":[...]} in `gh pr list --json` shape, instead of gh).
// The remote mode needs `gh` (pull requests readable); if the open-PR list
// cannot be read, nothing is deleted.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const OPEN_PR_LIMIT = 1000
const MERGED_PR_LIMIT = 5000
const PUSH_BATCH = 50

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\n$/, '')
}

function isAncestor(cwd, commit, of) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', commit, of], { cwd, stdio: 'ignore' })
  if (result.status === 0) return true
  if (result.status === 1) return false
  throw new Error(`git merge-base --is-ancestor ${commit} ${of} failed (${result.status})`)
}

function isProtected(name, main) {
  // gh-readonly-queue/* belongs to the merge queue, which deletes its own branches.
  return name === main || ['release/', 'stability/', 'gh-readonly-queue/'].some((prefix) => name.startsWith(prefix))
}

/** Every workflow file on main, concatenated: a branch named there (e.g. a CANDIDATE_REF) is in use. */
function workflowText(cwd, mainSha) {
  const files = git(cwd, ['ls-tree', '-r', '--name-only', mainSha, '--', '.github/workflows']).split('\n').filter(Boolean)
  return files.map((file) => git(cwd, ['show', `${mainSha}:${file}`])).join('\n')
}

function namedIn(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\w./-]|refs/heads/|origin/)${escaped}($|[^\\w./-])`, 'm').test(text)
}

function mainTip(cwd, remote, main) {
  return git(cwd, ['rev-parse', '--verify', `refs/remotes/${remote}/${main}^{commit}`])
}

/** Open and merged PRs, from a JSON file or `gh pr list`. Throws rather than guessing. */
export function loadPullRequests({ cwd, prsJson }) {
  if (prsJson) {
    const data = JSON.parse(readFileSync(prsJson, 'utf8'))
    if (!Array.isArray(data.open) || !Array.isArray(data.merged)) throw new Error(`${prsJson} needs open[] and merged[]`)
    return data
  }
  const gh = (state, limit, fields) =>
    JSON.parse(
      execFileSync('gh', ['pr', 'list', '--state', state, '--limit', String(limit), '--json', fields], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        maxBuffer: 64 * 1024 * 1024,
      }),
    )
  const open = gh('open', OPEN_PR_LIMIT, 'number,headRefName,baseRefName')
  if (open.length >= OPEN_PR_LIMIT) throw new Error(`open PR list hit the ${OPEN_PR_LIMIT} limit; refusing to guess`)
  const merged = gh('merged', MERGED_PR_LIMIT, 'number,headRefName,headRefOid,isCrossRepository,mergeCommit')
  return { open, merged }
}

/**
 * Decide, for every branch on `remote`, delete or keep.
 * @returns {{ mainSha: string, remove: {name,sha,reason}[], keep: {name,sha,reason}[] }}
 */
export function selectRemoteBranches({ cwd, remote = 'origin', main = 'main', prs }) {
  const mainRef = `refs/remotes/${remote}/${main}`
  const mainSha = mainTip(cwd, remote, main)
  const openHeads = new Set(prs.open.map((pr) => pr.headRefName))
  const openBases = new Set(prs.open.map((pr) => pr.baseRefName))
  const workflows = workflowText(cwd, mainSha)
  const mergedByTip = new Map()
  for (const pr of prs.merged) {
    if (pr.isCrossRepository || !pr.headRefOid || !pr.mergeCommit?.oid) continue
    mergedByTip.set(`${pr.headRefName}\t${pr.headRefOid}`, pr)
  }

  const prefix = `refs/remotes/${remote}/`
  const refs = git(cwd, ['for-each-ref', '--format=%(refname)%09%(objectname)%09%(symref)', prefix])
  const remove = []
  const keep = []
  for (const line of refs.split('\n').filter(Boolean)) {
    const [ref, sha, symref] = line.split('\t')
    if (symref) continue // refs/remotes/origin/HEAD
    const name = ref.slice(prefix.length)
    const decide = (list, reason) => list.push({ name, sha, reason })
    if (isProtected(name, main)) decide(keep, 'protected branch')
    else if (namedIn(workflows, name)) decide(keep, 'named in .github/workflows')
    else if (openHeads.has(name)) decide(keep, 'head of an open PR')
    else if (openBases.has(name)) decide(keep, 'base of an open PR')
    else if (sha === mainSha) decide(keep, 'at main tip (no work yet)')
    else if (isAncestor(cwd, sha, mainSha)) decide(remove, 'tip is on main')
    else {
      const pr = mergedByTip.get(`${name}\t${sha}`)
      const onMain = pr && hasCommit(cwd, pr.mergeCommit.oid) && isAncestor(cwd, pr.mergeCommit.oid, mainSha)
      // git cherry skips merge commits, so a branch with its own merge (and its resolution) is kept.
      const merges = onMain ? Number(git(cwd, ['rev-list', '--merges', '--count', `${mainRef}..${sha}`])) : 0
      const unique = onMain ? git(cwd, ['cherry', mainRef, sha]).split('\n').filter((l) => l.startsWith('+')) : null
      if (onMain && merges === 0 && unique.length === 0) decide(remove, `merged PR #${pr.number}, every patch on main`)
      else decide(keep, 'commits not on main')
    }
  }
  return { mainSha, remove, keep }
}

function hasCommit(cwd, sha) {
  return spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, stdio: 'ignore' }).status === 0
}

export function parseWorktreeList(text) {
  const entries = []
  for (const block of text.split(/\n\n+/)) {
    const entry = {}
    for (const line of block.split('\n').filter(Boolean)) {
      const space = line.indexOf(' ')
      const key = space === -1 ? line : line.slice(0, space)
      const value = space === -1 ? true : line.slice(space + 1)
      entry[key] = value
    }
    if (entry.worktree) entries.push(entry)
  }
  return entries
}

function realpathOr(p) {
  try {
    return realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

/** Newest mtime among the worktree's HEAD, index and HEAD reflog (read before any status call). */
function lastTouchedMs(worktreePath) {
  const gitDir = git(worktreePath, ['rev-parse', '--absolute-git-dir'])
  let newest = 0
  for (const file of ['HEAD', 'index', path.join('logs', 'HEAD')]) {
    const full = path.join(gitDir, file)
    if (existsSync(full)) newest = Math.max(newest, statSync(full).mtimeMs)
  }
  return newest
}

/**
 * Decide, for every worktree of the repository at `cwd`, remove or keep.
 * @returns {{ mainSha: string, remove: {path,branch,reason}[], keep: {path,branch,reason}[] }}
 */
export function selectWorktrees({ cwd, remote = 'origin', main = 'main', minIdleHours = 24, now = Date.now() }) {
  const mainSha = mainTip(cwd, remote, main)
  const current = realpathOr(git(cwd, ['rev-parse', '--show-toplevel']))
  const entries = parseWorktreeList(git(cwd, ['worktree', 'list', '--porcelain']))
  const remove = []
  const keep = []
  entries.forEach((entry, index) => {
    const branch = typeof entry.branch === 'string' ? entry.branch.replace(/^refs\/heads\//, '') : null
    const decide = (list, reason) => list.push({ path: entry.worktree, branch, reason })
    if (index === 0) return decide(keep, 'main worktree')
    if (realpathOr(entry.worktree) === current) return decide(keep, 'current worktree')
    if (entry.bare) return decide(keep, 'bare')
    if (entry.locked) return decide(keep, 'locked')
    if (entry.prunable || !existsSync(entry.worktree)) return decide(keep, 'directory missing (git worktree prune is separate)')
    if (!branch) return decide(keep, 'detached HEAD')
    if (isProtected(branch, main)) return decide(keep, 'protected branch')
    if (entry.HEAD === mainSha) return decide(keep, 'at main tip (no work yet)')
    if (!isAncestor(cwd, entry.HEAD, mainSha)) return decide(keep, 'branch not merged into main')
    const idleHours = (now - lastTouchedMs(entry.worktree)) / 3_600_000
    if (idleHours < minIdleHours) return decide(keep, `touched in the last ${minIdleHours}h`)
    const status = git(entry.worktree, ['status', '--porcelain=v1', '--untracked-files=all'])
    if (status !== '') return decide(keep, 'modified or untracked files')
    // `git worktree remove` deletes ignored files too (.env, local evidence, wrangler state): keep them.
    const ignored = git(entry.worktree, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'])
    if (ignored !== '') return decide(keep, 'ignored files present')
    // Status does not see edits hidden by skip-worktree (S/s) or assume-unchanged (lowercase tag).
    const hidden = git(entry.worktree, ['ls-files', '-v']).split('\n').some((line) => /^(S|[a-z])/.test(line))
    if (hidden) return decide(keep, 'skip-worktree or assume-unchanged entries')
    return decide(remove, 'merged and clean')
  })
  return { mainSha, remove, keep }
}

function summarizeKept(keep, verbose, label) {
  const byReason = new Map()
  for (const item of keep) byReason.set(item.reason, (byReason.get(item.reason) ?? 0) + 1)
  for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  kept ${count}: ${reason}`)
  if (verbose) for (const item of keep) console.log(`    keep ${label(item)}  (${item.reason})`)
}

/** Deletes in batches; each ref is leased to the SHA it was listed at. Returns the number of failures. */
export function deleteRemoteBranches(cwd, remote, branches) {
  let failed = 0
  for (let i = 0; i < branches.length; i += PUSH_BATCH) {
    const batch = branches.slice(i, i + PUSH_BATCH)
    const args = ['push', '--porcelain']
    for (const b of batch) args.push(`--force-with-lease=refs/heads/${b.name}:${b.sha}`)
    args.push(remote, ...batch.map((b) => `:refs/heads/${b.name}`))
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
    const lines = (result.stdout ?? '').split('\n')
    for (const b of batch) {
      const line = lines.find((l) => l.split('\t')[1] === `:refs/heads/${b.name}`)
      if (line && line.startsWith('-')) console.log(`deleted ${b.name} ${b.sha.slice(0, 8)}`)
      else {
        failed++
        console.error(`not deleted ${b.name}: ${line ? line.split('\t').slice(2).join(' ') : 'no push result'}`)
      }
    }
    if (result.status !== 0 && result.stderr) process.stderr.write(result.stderr)
  }
  return failed
}

function parseArgs(argv) {
  const opts = { mode: argv[0], apply: false, fetch: true, remote: 'origin', main: 'main', minIdleHours: 24, verbose: false }
  let sawDryRun = false
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`)
      return argv[++i]
    }
    if (arg === '--apply') opts.apply = true
    else if (arg === '--dry-run') sawDryRun = true
    else if (arg === '--no-fetch') opts.fetch = false
    else if (arg === '--verbose') opts.verbose = true
    else if (arg === '--remote') opts.remote = value()
    else if (arg === '--main') opts.main = value()
    else if (arg === '--prs-json') opts.prsJson = value()
    else if (arg === '--min-idle-hours') opts.minIdleHours = Number(value())
    else throw new Error(`unknown argument ${arg}`)
  }
  if (opts.apply && sawDryRun) throw new Error('--apply and --dry-run together')
  if (!['remote', 'worktrees'].includes(opts.mode)) throw new Error('first argument must be remote or worktrees')
  if (!Number.isFinite(opts.minIdleHours) || opts.minIdleHours < 0) throw new Error('--min-idle-hours must be >= 0')
  return opts
}

function main(argv) {
  const opts = parseArgs(argv)
  const cwd = process.cwd()
  const tag = opts.apply ? 'apply' : 'dry-run'
  if (opts.fetch) git(cwd, ['fetch', '--prune', '--quiet', opts.remote])

  if (opts.mode === 'remote') {
    const prs = loadPullRequests({ cwd, prsJson: opts.prsJson })
    const { mainSha, remove, keep } = selectRemoteBranches({ cwd, remote: opts.remote, main: opts.main, prs })
    const total = remove.length + keep.length
    console.log(`${tag}: ${opts.remote} at ${opts.main} ${mainSha.slice(0, 8)}: ${total} branches, ${remove.length} to delete, ${keep.length} kept`)
    summarizeKept(keep, opts.verbose, (b) => b.name)
    if (!opts.apply) {
      for (const b of remove) console.log(`  would delete ${b.name} ${b.sha.slice(0, 8)} (${b.reason})`)
      return 0
    }
    return deleteRemoteBranches(cwd, opts.remote, remove) === 0 ? 0 : 1
  }

  const { mainSha, remove, keep } = selectWorktrees({ cwd, remote: opts.remote, main: opts.main, minIdleHours: opts.minIdleHours })
  console.log(`${tag}: worktrees vs ${opts.remote}/${opts.main} ${mainSha.slice(0, 8)}: ${remove.length + keep.length} worktrees, ${remove.length} to remove, ${keep.length} kept`)
  summarizeKept(keep, opts.verbose, (w) => `${w.path} [${w.branch ?? 'detached'}]`)
  let failed = 0
  for (const w of remove) {
    if (!opts.apply) {
      console.log(`  would remove ${w.path} [${w.branch}]`)
      continue
    }
    const result = spawnSync('git', ['worktree', 'remove', w.path], { cwd, encoding: 'utf8' })
    if (result.status === 0) console.log(`removed ${w.path} [${w.branch}]`)
    else {
      failed++
      console.error(`not removed ${w.path}: ${(result.stderr ?? '').trim()}`)
    }
  }
  return failed === 0 ? 0 : 1
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === entry) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
  }
}
