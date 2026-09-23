import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { compareRuns, readRun, summarizeAudit } from '../compare-connect-performance.mjs'

const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n')
const conditions = {
  device: 'private-device-label', network: 'private-network-label', scenario: 'warm-connect',
  exit: 'same-exit', transport: 'reality', catalogDigest: '1'.repeat(64), policyDigest: '2'.repeat(64),
}
const checks = { aiResidential: 'passed', domesticDirect: 'passed', failClosed: 'passed' }
function run(durations, failed = 0) {
  let ts = 1000
  const rows = []
  for (const elapsedMs of durations) {
    rows.push({ ts, kind: 'connectBegin', node: 'PRIVATE' })
    rows.push({ ts: ts + elapsedMs, kind: 'connectOk', elapsedMs })
    ts += elapsedMs + 1000
  }
  for (let index = 0; index < failed; index++) {
    rows.push({ ts, kind: 'connectBegin' }, { ts: ts + 7000, kind: 'connectFail', error: 'PRIVATE' })
    ts += 8000
  }
  return {
    sourceCommit: 'a'.repeat(40), platform: 'windows', evidence: 'native-device', conditions,
    checks, expectedAttempts: durations.length + failed, summary: summarizeAudit(jsonl(rows), 'windows'),
  }
}

test('Windows cumulative stage offsets are differenced; failures, cancellation and unfinished attempts survive', () => {
  const summary = summarizeAudit(jsonl([
    { ts: 1000, kind: 'connectBegin' },
    { ts: 1100, kind: 'stage', stage: 'preparingService', elapsedMs: 100 },
    { ts: 1800, kind: 'stage', stage: 'securingDNS', elapsedMs: 800 },
    { ts: 3900, kind: 'stage', stage: 'verifyingTraffic', elapsedMs: 2900 },
    { ts: 6000, kind: 'connectOk', elapsedMs: 4700 },
    { ts: 8000, kind: 'connectBegin' }, { ts: 18000, kind: 'connectFail' },
    { ts: 19000, kind: 'connectBegin' }, { ts: 20000, kind: 'disconnectBegin' },
    { ts: 21000, kind: 'connectBegin' }, { ts: 22000, kind: 'connectBegin' },
  ]), 'windows')
  assert.deepEqual(summary.outcomes, { connected: 1, failed: 1, cancelled: 1, incomplete: 2 })
  assert.equal(summary.successRate, 0.2)
  assert.deepEqual(summary.connected, { samples: 1, p50Ms: 4700, p95Ms: 4700 })
  assert.equal(summary.stages.preparingService.p50Ms, 700)
  assert.equal(summary.stages.securingDNS.p50Ms, 2100)
  assert.equal(summary.stages.verifyingTraffic.p50Ms, 1800)
  assert.equal(summary.failed.p50Ms, 10000)
})

test('Mac audit envelope measures event timing and exposes evidence loss rather than treating a stage reset as Connect', () => {
  const row = (ms, event, extra = {}) => ({
    kind: 'protection_event', session_id: 'test-session', timestamp: new Date(1900000000000 + ms).toISOString(), event, ...extra,
  })
  const summary = summarizeAudit(jsonl([
    row(0, 'connect_requested'), row(300, 'connection_stage', { stage: 'Securing DNS…' }),
    row(1700, 'connection_stage', { stage: 'Verifying traffic protection…' }), row(2300, 'connected'),
    row(2350, 'connection_stage', { stage: 'Preparing protection…' }),
    row(5000, 'connect_requested'), row(11000, 'connect_failed', { duration_ms: '5900' }),
    { kind: 'audit_dropped', dropped_entries: 5 },
  ]), 'macos')
  assert.deepEqual(summary.outcomes, { connected: 1, failed: 1, cancelled: 0, incomplete: 0 })
  assert.equal(summary.connected.p50Ms, 2300)
  assert.equal(summary.failed.p50Ms, 5900)
  assert.equal(summary.stages.securingDNS.p50Ms, 1400)
  assert.equal(summary.evidenceLoss, true)
  assert.equal(summary.orphanedEvents, 0)
})

test('tail latency and lower connection success prevent a misleading median speed claim', () => {
  const baseline = run([...Array(18).fill(10000), 20000, 40000])
  const candidate = run([...Array(18).fill(6000), 15000, 30000], 5)
  const report = compareRuns(baseline, candidate)
  assert.deepEqual(report.latencyReductionPercent, { p50: 40, p95: 25 })
  assert.equal(report.observed30PercentTarget, null)
  assert.ok(report.limitations.includes('candidate success rate regressed'))
  const withoutFailures = compareRuns(baseline, run([...Array(18).fill(6000), 15000, 30000]))
  assert.equal(withoutFailures.observed30PercentTarget, false)
  const improved = compareRuns(baseline, run([...Array(18).fill(6000), 12000, 24000]))
  assert.equal(improved.observed30PercentTarget, true)
  assert.equal(improved.releaseAccepted, false)
})

test('missing Windows monotonic success timing and missing whole attempts cannot qualify a faster sample', () => {
  const baseline = run(Array(20).fill(10000))
  const rows = []
  for (let index = 0; index < 20; index++) {
    rows.push({ ts: index * 10000, kind: 'connectBegin' }, { ts: index * 10000 + 5000, kind: 'connectOk' })
  }
  const candidate = { ...run(Array(20).fill(5000)), summary: summarizeAudit(jsonl(rows), 'windows') }
  assert.equal(candidate.summary.invalidTiming, true)
  assert.equal(candidate.summary.connected.samples, 0)
  assert.equal(compareRuns(baseline, candidate).observed30PercentTarget, null)
  assert.equal(compareRuns(baseline, { ...run(Array(20).fill(5000)), expectedAttempts: 21 }).observed30PercentTarget, null)
})

test('display rounding cannot turn a sub-threshold improvement into a met target', () => {
  const report = compareRuns(run(Array(20).fill(100000)), run(Array(20).fill(70001)))
  assert.equal(report.latencyReductionPercent.p50, 30)
  assert.equal(report.observed30PercentTarget, false)
})

test('synthetic, short, mismatched and unproven routing comparisons cannot qualify the target', () => {
  const baseline = run(Array(20).fill(10000))
  const candidate = run(Array(20).fill(5000))
  assert.throws(() => compareRuns(baseline, { ...candidate, conditions: { ...conditions, transport: 'hy2' } }), /transport/)
  assert.equal(compareRuns({ ...baseline, evidence: 'synthetic' }, { ...candidate, evidence: 'synthetic' }).observed30PercentTarget, null)
  assert.equal(compareRuns(baseline, run([5000])).observed30PercentTarget, null)
  assert.equal(compareRuns(baseline, { ...candidate, checks: { ...checks, aiResidential: 'not-run' } }).observed30PercentTarget, null)
})

test('malformed input, orphan completion and backwards timing do not silently disappear', () => {
  assert.throws(() => summarizeAudit('{secret:not-json}', 'windows'), /invalid JSON at audit line 1/)
  assert.throws(() => summarizeAudit('{"ts":0,"kind":"connectBegin"}\nnull', 'windows'), /invalid audit record/)
  assert.throws(() => summarizeAudit('{}', 'windows'), /no connection attempts/)
  const summary = summarizeAudit(jsonl([
    { ts: 1000, kind: 'connectOk', elapsedMs: 10 },
    { ts: 2000, kind: 'connectBegin' },
    { ts: 1900, kind: 'connectOk', elapsedMs: 20 },
  ]), 'windows')
  assert.equal(summary.orphanedEvents, 1)
  assert.equal(summary.invalidTiming, true)
})

test('a Mac process restart cannot splice an old request to a different session completion', () => {
  const summary = summarizeAudit(jsonl([
    { kind: 'protection_event', timestamp: '2026-09-22T12:00:00Z', session_id: 'old', event: 'connect_requested' },
    { kind: 'protection_event', timestamp: '2026-09-22T12:00:02Z', session_id: 'new', event: 'connected' },
  ]), 'macos')
  assert.deepEqual(summary.outcomes, { connected: 0, failed: 0, cancelled: 0, incomplete: 1 })
  assert.equal(summary.evidenceLoss, true)
  assert.equal(summary.orphanedEvents, 1)
  assert.equal(summary.connected.samples, 0)
})

test('CLI reads actual log bytes, hashes provenance and omits private labels and raw events', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tono-connect-compare-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const metadata = {
    schemaVersion: 1, sourceCommit: 'a'.repeat(40), platform: 'windows', evidence: 'synthetic',
    conditions, checks, expectedAttempts: 1, auditLog: 'audit.jsonl',
  }
  await writeFile(path.join(root, 'audit.jsonl'), jsonl([
    { ts: 0, kind: 'signInOk', email: 'private@example.invalid' },
    { ts: 1000, kind: 'connectBegin', node: 'PRIVATE' },
    { ts: 8000, kind: 'connectOk', elapsedMs: 7000 },
  ]))
  const baseline = path.join(root, 'baseline.json')
  const candidate = path.join(root, 'candidate.json')
  await writeFile(baseline, JSON.stringify(metadata))
  await writeFile(candidate, JSON.stringify({ ...metadata, sourceCommit: 'b'.repeat(40) }))
  const measured = await readRun(baseline)
  assert.match(measured.auditSha256, /^[0-9a-f]{64}$/)
  const cli = spawnSync(process.execPath, [new URL('../compare-connect-performance.mjs', import.meta.url).pathname, baseline, candidate], { encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  const report = JSON.parse(cli.stdout)
  assert.equal(report.baseline.auditSha256, measured.auditSha256)
  assert.equal(report.observed30PercentTarget, null)
  assert.equal(report.baseline.connected.p50Ms, 7000)
  assert.doesNotMatch(cli.stdout, /private@example|private-device|private-network|PRIVATE/)
})
