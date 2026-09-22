#!/usr/bin/env node
// Local, read-only comparison of the clients' existing traffic-audit JSONL.
// No network calls, uploads, network configuration, or inferred device acceptance.

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_LOG_BYTES = 32 * 1024 * 1024
const CONDITIONS = ['device', 'network', 'scenario', 'exit', 'transport', 'catalogDigest', 'policyDigest']
const GUARDS = ['aiResidential', 'domesticDirect', 'failClosed']
const STAGES = new Set([
  'preparing', 'preparingService', 'preparingHelper', 'startingKillSwitch',
  'startingTunnel', 'lockingTraffic', 'securingDNS', 'applyingCloudPolicy',
  'checkingExit', 'verifyingTraffic',
])
// ConnectionStage.rawValue is deliberately human-readable on macOS, unlike
// the Windows audit wire key. Normalize only these known values, not raw text.
const MAC_STAGES = new Map([
  ['Preparing protection…', 'preparing'], ['Preparing secure helper…', 'preparingHelper'],
  ['Starting Kill Switch…', 'startingKillSwitch'], ['Starting protected tunnel…', 'startingTunnel'],
  ['Locking traffic to tunnel…', 'lockingTraffic'], ['Applying secure app routing…', 'applyingCloudPolicy'],
  ['Securing DNS…', 'securingDNS'], ['Checking secure exit…', 'checkingExit'],
  ['Verifying traffic protection…', 'verifyingTraffic'],
])

function requireValue(condition, message) {
  if (!condition) throw new Error(message)
}

function milliseconds(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null
  const number = typeof value === 'string' ? Number(value) : value
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

function timestamp(record, platform) {
  if (platform === 'windows') return milliseconds(record.ts)
  if (typeof record.timestamp !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(record.timestamp)) return null
  const value = Date.parse(record.timestamp)
  return milliseconds(value)
}

function percentile(values, fraction) {
  if (!values.length) return null
  // Nearest rank; retain tail outliers instead of interpolating them away.
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * fraction) - 1]
}

function distribution(values) {
  const measured = values.filter(value => milliseconds(value) !== null)
  return { samples: measured.length, p50Ms: percentile(measured, 0.5), p95Ms: percentile(measured, 0.95) }
}

export function summarizeAudit(text, platform) {
  requireValue(['windows', 'macos'].includes(platform), 'platform must be windows or macos')
  const attempts = []
  let pending = null
  let previousTimestamp = null
  let orphanedEvents = 0
  let evidenceLoss = false
  let invalidTiming = false
  const finish = (outcome, record, at) => {
    if (!pending) { orphanedEvents++; return }
    const raw = platform === 'windows' ? record.elapsedMs : record.duration_ms
    const explicit = milliseconds(raw)
    // Windows ConnectOk always carries a monotonic measurement. Missing or
    // malformed evidence must not silently switch the comparison to wall time.
    const unusable = explicit === null && (raw !== undefined || (platform === 'windows' && outcome === 'connected'))
    const elapsed = unusable ? null : explicit ?? (at - pending.startedAt)
    if (elapsed === null || elapsed < 0 || elapsed < pending.lastOffset) invalidTiming = true
    if (pending.stage && elapsed !== null && elapsed >= pending.lastOffset) {
      pending.stages[pending.stage] = (pending.stages[pending.stage] ?? 0) + elapsed - pending.lastOffset
    }
    attempts.push({ outcome, elapsed, stages: pending.stages })
    pending = null
  }

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    requireValue(Buffer.byteLength(line) <= 1024 * 1024, `audit line ${index + 1} exceeds size limit`)
    let record
    try { record = JSON.parse(line) } catch { throw new Error(`invalid JSON at audit line ${index + 1}`) }
    requireValue(record !== null && typeof record === 'object' && !Array.isArray(record), `invalid audit record at line ${index + 1}`)
    if (['audit_dropped', 'audit_disabled', 'auditDisabled'].includes(record.kind)) evidenceLoss = true
    const event = platform === 'windows' ? record.kind
      : record.kind === 'protection_event' ? record.event : null
    const relevant = platform === 'windows'
      ? ['connectBegin', 'stage', 'connectOk', 'connectFail', 'disconnectBegin']
      : ['connect_requested', 'connection_stage', 'connected', 'connect_failed', 'disconnect_requested']
    if (!relevant.includes(event)) continue
    const at = timestamp(record, platform)
    requireValue(at !== null, `missing or invalid timestamp at audit line ${index + 1}`)
    if (previousTimestamp !== null && at < previousTimestamp) invalidTiming = true
    previousTimestamp = at
    if (platform === 'macos' && pending && record.session_id !== pending.session) {
      attempts.push({ outcome: 'incomplete', elapsed: null, stages: pending.stages })
      pending = null
      evidenceLoss = true
    }

    if (event === 'connectBegin' || event === 'connect_requested') {
      if (pending) attempts.push({ outcome: 'incomplete', elapsed: null, stages: pending.stages })
      pending = { startedAt: at, session: record.session_id, stage: null, lastOffset: 0, stages: {} }
    } else if (event === 'stage' || event === 'connection_stage') {
      // A Mac reset to `preparing` after Connected is not another attempt.
      if (!pending) continue
      const offset = platform === 'windows' ? milliseconds(record.elapsedMs) : at - pending.startedAt
      if (offset === null || offset < pending.lastOffset) { invalidTiming = true; continue }
      if (pending.stage) {
        pending.stages[pending.stage] = (pending.stages[pending.stage] ?? 0) + offset - pending.lastOffset
      }
      pending.stage = platform === 'macos' ? MAC_STAGES.get(record.stage) ?? 'other'
        : STAGES.has(record.stage) ? record.stage : 'other'
      pending.lastOffset = offset
    } else if (event === 'connectOk' || event === 'connected') {
      finish('connected', record, at)
    } else if (event === 'connectFail' || event === 'connect_failed') {
      finish('failed', record, at)
    } else if (pending) {
      finish('cancelled', record, at)
    }
  }
  if (pending) attempts.push({ outcome: 'incomplete', elapsed: null, stages: pending.stages })
  requireValue(attempts.length > 0, 'audit contains no connection attempts')
  const counts = { connected: 0, failed: 0, cancelled: 0, incomplete: 0 }
  for (const attempt of attempts) counts[attempt.outcome]++
  const successful = attempts.filter(attempt => attempt.outcome === 'connected')
  const stages = {}
  for (const stage of new Set(successful.flatMap(attempt => Object.keys(attempt.stages)))) {
    stages[stage] = distribution(successful.filter(attempt => stage in attempt.stages).map(attempt => attempt.stages[stage]))
  }
  return {
    attempts: attempts.length, outcomes: counts,
    successRate: counts.connected / attempts.length,
    connected: distribution(successful.map(attempt => attempt.elapsed)),
    failed: distribution(attempts.filter(attempt => attempt.outcome === 'failed').map(attempt => attempt.elapsed)),
    stages, orphanedEvents, evidenceLoss, invalidTiming,
    timingBasis: platform === 'windows' ? 'client monotonic elapsed for successful attempts' : 'audit event wall-clock timestamps',
  }
}

async function boundedRead(file, limit) {
  const info = await stat(file)
  requireValue(info.isFile(), 'input must be a regular file')
  requireValue(info.size <= limit, 'input exceeds size limit')
  const bytes = await readFile(file)
  requireValue(bytes.length <= limit, 'input exceeds size limit')
  return bytes
}

export async function readRun(file) {
  const metadata = JSON.parse(await boundedRead(file, 64 * 1024))
  requireValue(metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata), 'measurement must be an object')
  requireValue(metadata.schemaVersion === 1, 'measurement schemaVersion must be 1')
  requireValue(/^[0-9a-f]{40}$/.test(metadata.sourceCommit ?? ''), 'sourceCommit must be a full lowercase Git SHA')
  requireValue(['native-device', 'hosted', 'synthetic'].includes(metadata.evidence), 'evidence must be native-device, hosted or synthetic')
  requireValue(typeof metadata.auditLog === 'string' && metadata.auditLog.length > 0, 'auditLog is required')
  requireValue(Number.isSafeInteger(metadata.expectedAttempts) && metadata.expectedAttempts > 0, 'expectedAttempts must be a positive integer independently counted during capture')
  for (const key of CONDITIONS) {
    requireValue(typeof metadata.conditions?.[key] === 'string' && metadata.conditions[key].trim().length > 0, `condition ${key} is required`)
  }
  for (const key of GUARDS) {
    requireValue(['passed', 'failed', 'not-run'].includes(metadata.checks?.[key]), `check ${key} must be passed, failed or not-run`)
  }
  const bytes = await boundedRead(path.resolve(path.dirname(file), metadata.auditLog), MAX_LOG_BYTES)
  return {
    sourceCommit: metadata.sourceCommit, platform: metadata.platform, evidence: metadata.evidence,
    expectedAttempts: metadata.expectedAttempts,
    conditions: Object.fromEntries(CONDITIONS.map(key => [key, metadata.conditions[key]])),
    checks: Object.fromEntries(GUARDS.map(key => [key, metadata.checks[key]])),
    auditSha256: createHash('sha256').update(bytes).digest('hex'),
    summary: summarizeAudit(new TextDecoder('utf-8', { fatal: true }).decode(bytes), metadata.platform),
  }
}

export function compareRuns(baseline, candidate) {
  requireValue(baseline.platform === candidate.platform, 'platforms differ')
  requireValue(baseline.evidence === candidate.evidence, 'evidence environments differ')
  for (const key of CONDITIONS) {
    requireValue(baseline.conditions[key] === candidate.conditions[key], `comparison condition differs: ${key}`)
  }
  const reasons = []
  if (baseline.evidence !== 'native-device') reasons.push('not a native-device comparison')
  for (const [label, run] of [['baseline', baseline], ['candidate', candidate]]) {
    if (run.summary.connected.samples < 20) reasons.push(`${label} has fewer than 20 successful attempts`)
    if (run.expectedAttempts !== run.summary.attempts) reasons.push(`${label} attempt count differs from the independent capture count`)
    if (run.summary.outcomes.incomplete || run.summary.orphanedEvents || run.summary.evidenceLoss || run.summary.invalidTiming) reasons.push(`${label} has incomplete or inconsistent timing evidence`)
    if (GUARDS.some(key => run.checks[key] !== 'passed')) reasons.push(`${label} routing/protection checks are not all recorded passed`)
  }
  if (candidate.summary.successRate < baseline.summary.successRate) reasons.push('candidate success rate regressed')
  const reduction = key => {
    const before = baseline.summary.connected[key]
    const after = candidate.summary.connected[key]
    return before > 0 && after !== null ? (1 - after / before) * 100 : null
  }
  const p50 = reduction('p50Ms')
  const p95 = reduction('p95Ms')
  const display = value => value === null ? null : Math.round(value * 100) / 100
  const latencyReductionPercent = { p50: display(p50), p95: display(p95) }
  if (p50 === null || p95 === null) reasons.push('successful latency comparison is unavailable')
  const publicRun = run => ({
    sourceCommit: run.sourceCommit, auditSha256: run.auditSha256, checks: run.checks,
    expectedAttempts: run.expectedAttempts, ...run.summary,
  })
  return {
    platform: baseline.platform, evidence: baseline.evidence,
    // Do not echo the local device/network/exit labels, paths, raw errors, or account data.
    conditionsSha256: createHash('sha256').update(JSON.stringify(baseline.conditions)).digest('hex'),
    baseline: publicRun(baseline), candidate: publicRun(candidate), latencyReductionPercent,
    observed30PercentTarget: reasons.length ? null : p50 >= 30 && p95 >= 30,
    limitations: [
      ...reasons,
      'Source identity, conditions and routing/protection checks are operator-supplied, not authenticated by this tool.',
      'Audit delivery is best-effort. Compare the attempt count with an independent capture record; missing whole attempts cannot be discovered from JSONL alone.',
      'Success-only latency is shown alongside all attempt outcomes; it does not prove throughput, AI response speed or release acceptance.',
    ],
    releaseAccepted: false,
  }
}

async function main(args) {
  requireValue(args.length === 2, 'Usage: node tooling/scripts/compare-connect-performance.mjs BASELINE.json CANDIDATE.json')
  const [baseline, candidate] = await Promise.all(args.map(readRun))
  console.log(JSON.stringify(compareRuns(baseline, candidate), null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    // Read/parse errors can contain local paths or fragments of private input.
    console.error(error.code ? `Comparison input could not be read (${error.code}).` : error instanceof SyntaxError ? 'Invalid measurement JSON.' : error.message)
    process.exitCode = 1
  })
}
