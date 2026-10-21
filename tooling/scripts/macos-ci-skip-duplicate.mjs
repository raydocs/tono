// Skip a macOS CI push that would retest a tree the suite already passed.
//
// release/macos and release/windows: skip only when compare says this SHA is
// already on main (identical or behind, ahead_by 0). A release-only commit
// still runs.
//
// main: skip only when this SHA already has a completed successful macOS
// suite (the merge queue tests the SHA that lands), or this is a merge
// commit whose macOS paths match the second parent and that parent’s suite
// succeeded. A direct push, a conflict that touches a macOS path, a
// path-skipped ci-gate, a truncated file list, or an API failure does not
// skip. pull_request, workflow_dispatch and workflow_call do not skip.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pushPathList } from './ci-gate-changes.mjs'

const MACOS_JOBS = ['build', 'unit-tests', 'policy-tests', 'privileged-tests']

export function skipDuplicateMacosCi({
  event,
  ref,
  status,
  aheadBy,
  parents,
  macosDiff,
  suiteOnSha,
  suiteOnParent,
}) {
  if (event !== 'push') return false
  if (ref === 'refs/heads/release/macos' || ref === 'refs/heads/release/windows') {
    if (status !== 'identical' && status !== 'behind') return false
    const ahead = typeof aheadBy === 'number' ? aheadBy : Number(aheadBy)
    return Number.isInteger(ahead) && ahead === 0
  }
  if (ref !== 'refs/heads/main') return false
  if (suiteOnSha === true) return true
  const parentCount = typeof parents === 'number' ? parents : Number(parents)
  return parentCount === 2 && macosDiff === 'empty' && suiteOnParent === true
}

function macosJobName(name) {
  const text = String(name || '')
  const bare = text.startsWith('macos / ') ? text.slice('macos / '.length) : text
  return MACOS_JOBS.includes(bare) ? bare : ''
}

function isCurrentRun(check, runId) {
  if (!runId) return false
  const needle = `/runs/${runId}/`
  return String(check.details_url || '').includes(needle) || String(check.html_url || '').includes(needle)
}

// checks are newest-first, as the check-runs API returns them.
export function macosSuitePassed(checks, currentRunId) {
  if (!Array.isArray(checks)) return false
  const latest = new Map()
  for (const check of checks) {
    if (!check || isCurrentRun(check, currentRunId)) continue
    const job = macosJobName(check.name)
    if (!job || latest.has(job)) continue
    latest.set(job, check.conclusion || '')
  }
  return MACOS_JOBS.every((job) => latest.get(job) === 'success')
}

function matchMacosPath(file, pattern) {
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3)
    return file === prefix || file.startsWith(`${prefix}/`)
  }
  if (pattern.includes('*') || pattern.includes('?')) return null
  return file === pattern
}

export function classifyMacosDiff({ files, truncated, patterns }) {
  if (truncated || !Array.isArray(files) || !Array.isArray(patterns) || patterns.length === 0) return 'unknown'
  for (const pattern of patterns) {
    if (typeof pattern !== 'string') return 'unknown'
    if (pattern.includes('?') || (pattern.includes('*') && !pattern.endsWith('/**'))) return 'unknown'
  }
  for (const file of files) {
    if (typeof file !== 'string' || file === '') return 'unknown'
    // GitHub's order: the last matching pattern decides, and `!` excludes.
    let selected = false
    for (const pattern of patterns) {
      const negated = pattern.startsWith('!')
      const hit = matchMacosPath(file, negated ? pattern.slice(1) : pattern)
      if (hit === null) return 'unknown'
      if (hit) selected = !negated
    }
    if (selected) return 'changed'
  }
  return 'empty'
}

function ghApi(apiPath) {
  const out = execFileSync('gh', ['api', apiPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(out)
}

function checkRuns(repo, sha) {
  const page = ghApi(`repos/${repo}/commits/${sha}/check-runs?per_page=100`)
  return Array.isArray(page.check_runs) ? page.check_runs : []
}

function releaseCompare(repo, sha) {
  try {
    const meta = ghApi(`repos/${repo}/compare/main...${sha}`)
    if (typeof meta.status !== 'string' || typeof meta.ahead_by !== 'number') {
      return { status: 'unknown', aheadBy: 1 }
    }
    return { status: meta.status, aheadBy: meta.ahead_by }
  } catch (error) {
    process.stderr.write(`compare API failed; running the macOS suite (${error.message})\n`)
    return { status: 'unknown', aheadBy: 1 }
  }
}

function macosPatterns() {
  const workflow = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/macos-ci.yml'), 'utf8')
  const patterns = pushPathList(workflow)
  if (!patterns) throw new Error('macos-ci.yml has no push path list')
  return patterns
}

function mainPushFacts(repo, sha, runId) {
  let parents = []
  try {
    const commit = ghApi(`repos/${repo}/commits/${sha}`)
    parents = Array.isArray(commit.parents) ? commit.parents.map((parent) => parent.sha).filter(Boolean) : []
  } catch (error) {
    process.stderr.write(`commit API failed; running the macOS suite (${error.message})\n`)
    return { parents: 0, macosDiff: 'unknown', suiteOnSha: false, suiteOnParent: false }
  }
  let suiteOnSha = false
  try {
    suiteOnSha = macosSuitePassed(checkRuns(repo, sha), runId)
  } catch (error) {
    process.stderr.write(`check-runs API failed; running the macOS suite (${error.message})\n`)
  }
  if (suiteOnSha || parents.length !== 2) {
    return { parents: parents.length, macosDiff: 'unknown', suiteOnSha, suiteOnParent: false }
  }
  const head = parents[1]
  let macosDiff = 'unknown'
  try {
    const compared = ghApi(`repos/${repo}/compare/${head}...${sha}`)
    const files = Array.isArray(compared.files) ? compared.files.map((file) => file.filename) : null
    const truncated = !files || files.length >= 300
    macosDiff = classifyMacosDiff({ files, truncated, patterns: macosPatterns() })
  } catch (error) {
    process.stderr.write(`compare API failed; running the macOS suite (${error.message})\n`)
  }
  if (macosDiff !== 'empty') {
    return { parents: parents.length, macosDiff, suiteOnSha, suiteOnParent: false }
  }
  let suiteOnParent = false
  try {
    suiteOnParent = macosSuitePassed(checkRuns(repo, head), runId)
  } catch (error) {
    process.stderr.write(`parent check-runs API failed; running the macOS suite (${error.message})\n`)
  }
  return { parents: parents.length, macosDiff, suiteOnSha, suiteOnParent }
}

export function decideFromEnv(env = process.env) {
  const event = env.EVENT_NAME || ''
  const ref = env.REF_NAME || ''
  const sha = env.GITHUB_SHA || ''
  const repo = env.GITHUB_REPOSITORY || ''
  const runId = env.GITHUB_RUN_ID || ''
  if (event !== 'push') return false
  if (!repo || !sha) return false
  if (ref === 'refs/heads/release/macos' || ref === 'refs/heads/release/windows') {
    const compared = releaseCompare(repo, sha)
    return skipDuplicateMacosCi({ event, ref, status: compared.status, aheadBy: compared.aheadBy })
  }
  if (ref !== 'refs/heads/main') return false
  const facts = mainPushFacts(repo, sha, runId)
  return skipDuplicateMacosCi({
    event,
    ref,
    parents: facts.parents,
    macosDiff: facts.macosDiff,
    suiteOnSha: facts.suiteOnSha,
    suiteOnParent: facts.suiteOnParent,
  })
}

function arg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1 || index + 1 >= process.argv.length) return ''
  return process.argv[index + 1]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const skip = process.argv.includes('--decide')
    ? decideFromEnv()
    : skipDuplicateMacosCi({
      event: arg('--event'),
      ref: arg('--ref'),
      status: arg('--status'),
      aheadBy: arg('--ahead-by'),
      parents: arg('--parents'),
      macosDiff: arg('--macos-diff'),
      suiteOnSha: arg('--suite-on-sha') === 'true',
      suiteOnParent: arg('--suite-on-parent') === 'true',
    })
  process.stdout.write(skip ? 'true' : 'false')
}
