// Decides which reusable CI workflows ci-gate calls, and whether the
// aggregate `ci-gate` job is allowed to pass.
//
// Path lists for workflows that push to a branch are read from that
// workflow's `on.push.paths` — the same lists `pull_request` used before
// ci-gate became the only pull-request entry. connect-bench has no push
// trigger; CONNECT_BENCH_PATHS is that workflow's former pull_request list.

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const CONNECT_BENCH_PATHS = [
  'tooling/perf/connect-bench/**',
  'apps/windows/crates/tono-core/src/config.rs',
  'apps/windows/service/src/core/runtime_generation/owned_config.rs',
  'apps/macos/Tono/Core/Configuration/ConfigPipeline+Runtime.swift',
  'apps/macos/Tono/Core/Configuration/ConfigPipeline+Nodes.swift',
  '.github/workflows/connect-bench.yml',
]

const PUSH_WORKFLOWS = [
  ['macos', 'macos-ci.yml'],
  ['windows', 'windows-ci.yml'],
  ['services', 'services-ci.yml'],
  ['singBox', 'sing-box-alpha9-check.yml'],
]

const OUTPUT_KEYS = {
  macos: 'macos',
  windows: 'windows',
  services: 'services',
  singBox: 'sing_box',
  connectBench: 'connect_bench',
}

export function pushPathList(yamlText) {
  const lines = yamlText.split(/\n/)
  let inOn = false
  let inPush = false
  let inPaths = false
  let sawPush = false
  const paths = []
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (/^on:\s*$/.test(line)) {
      inOn = true
      inPush = false
      inPaths = false
      continue
    }
    if (inOn && /^\S/.test(line)) {
      inOn = false
      inPush = false
      inPaths = false
    }
    if (!inOn) continue
    if (/^ {2}push:\s*$/.test(line)) {
      inPush = true
      inPaths = false
      sawPush = true
      continue
    }
    if (inPush && /^ {2}\S/.test(line)) {
      inPush = false
      inPaths = false
    }
    if (!inPush) continue
    if (/^ {4}paths:\s*$/.test(line)) {
      inPaths = true
      continue
    }
    if (!inPaths) continue
    const item = line.match(/^ {6}- (.+)$/)
    if (item) {
      paths.push(item[1].replace(/^['"]|['"]$/g, ''))
      continue
    }
    if (/^\s*$/.test(line) || /^\s+#/.test(line)) continue
    inPaths = false
  }
  if (!sawPush) return null
  if (paths.length === 0) throw new Error('push filter has no paths')
  return paths
}

export function filtersFromRepo(repoRoot = root) {
  const filters = {}
  for (const [key, file] of PUSH_WORKFLOWS) {
    const yaml = readFileSync(path.join(repoRoot, '.github/workflows', file), 'utf8')
    const paths = pushPathList(yaml)
    if (!paths) throw new Error(`${file} has no push path list for ci-gate to reuse`)
    filters[key] = paths
  }
  const connect = readFileSync(path.join(repoRoot, '.github/workflows/connect-bench.yml'), 'utf8')
  if (pushPathList(connect)) {
    throw new Error('connect-bench.yml push paths would diverge from CONNECT_BENCH_PATHS')
  }
  filters.connectBench = CONNECT_BENCH_PATHS
  return filters
}

export function matchingWorkflows(changedFiles, filters) {
  const selected = {}
  for (const [key, patterns] of Object.entries(filters)) {
    selected[key] = changedFiles.some((file) => patterns.some((pattern) => path.matchesGlob(file, pattern)))
  }
  return selected
}

export function isSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value)
}

// pull_request diffs the checkout SHA (the merge commit, `github.sha`) against
// `pull_request.base.sha`. merge_group diffs the event's own base_sha and head_sha.
export function diffEndpoints(eventName, event, sha) {
  if (eventName === 'workflow_dispatch') return { all: true }
  if (eventName === 'pull_request') {
    const base = event?.pull_request?.base?.sha
    if (!isSha(base) || !isSha(sha)) throw new Error('pull_request is missing base or head sha')
    return { base, head: sha }
  }
  if (eventName === 'merge_group') {
    const base = event?.merge_group?.base_sha
    const head = event?.merge_group?.head_sha
    if (!isSha(base) || !isSha(head)) throw new Error('merge_group is missing base_sha or head_sha')
    return { base, head }
  }
  throw new Error(`unsupported event ${eventName}`)
}

function ensureCommit(sha) {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' })
    return
  } catch {
    // A full checkout already has both SHAs. This is the fallback when it does not.
  }
  execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', sha], { stdio: 'inherit' })
  execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'inherit' })
}

export function changedFilesBetween(base, head) {
  if (!isSha(base) || !isSha(head)) throw new Error('refusing to diff a non-sha')
  ensureCommit(base)
  ensureCommit(head)
  const out = execFileSync('git', ['diff', '--name-only', '--no-renames', base, head], { encoding: 'utf8' })
  return out.split('\n').filter(Boolean)
}

export function aggregateStatus({ changes, calls }) {
  const problems = []
  if (changes !== 'success') problems.push(`change detection ${changes || 'missing'}`)
  for (const call of calls) {
    if (changes !== 'success') {
      if (call.result === 'failure' || call.result === 'cancelled') problems.push(`${call.name} ${call.result}`)
      continue
    }
    if (call.should !== 'true' && call.should !== 'false') {
      problems.push(`${call.name} selection ${call.should || 'missing'}`)
      continue
    }
    if (call.should === 'true') {
      if (call.result !== 'success') problems.push(`${call.name} ${call.result || 'missing'}`)
    } else if (call.result !== 'skipped') {
      problems.push(`${call.name} ${call.result || 'missing'} (expected skipped)`)
    }
  }
  return problems
}

function writeOutputs(selected) {
  const lines = Object.entries(OUTPUT_KEYS).map(([key, output]) => `${output}=${selected[key] ? 'true' : 'false'}`)
  const text = `${lines.join('\n')}\n`
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text)
  process.stdout.write(text)
}

function detect() {
  const eventName = process.env.GITHUB_EVENT_NAME
  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
    : {}
  const endpoints = diffEndpoints(eventName, event, process.env.GITHUB_SHA)
  const filters = filtersFromRepo(process.cwd())
  const selected = endpoints.all
    ? Object.fromEntries(Object.keys(filters).map((key) => [key, true]))
    : matchingWorkflows(changedFilesBetween(endpoints.base, endpoints.head), filters)
  writeOutputs(selected)
}

function aggregateCli() {
  const calls = [
    ['macos', 'MACOS', 'MACOS_SHOULD'],
    ['windows', 'WINDOWS', 'WINDOWS_SHOULD'],
    ['services', 'SERVICES', 'SERVICES_SHOULD'],
    ['sing-box', 'SING_BOX', 'SING_BOX_SHOULD'],
    ['connect-bench', 'CONNECT_BENCH', 'CONNECT_BENCH_SHOULD'],
  ].map(([name, resultKey, shouldKey]) => {
    const should = process.env[shouldKey] || ''
    return { name, result: process.env[resultKey] || '', should }
  })
  const problems = aggregateStatus({ changes: process.env.CHANGES || '', calls })
  for (const call of calls) console.log(`${call.name}: should=${call.should || 'missing'} result=${call.result || 'missing'}`)
  if (problems.length) {
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
    return
  }
  console.log('ci-gate pass')
}

function main() {
  const command = process.argv[2] || 'detect'
  if (command === 'detect') detect()
  else if (command === 'aggregate') aggregateCli()
  else throw new Error(`unknown command ${command}`)
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === entry) main()
