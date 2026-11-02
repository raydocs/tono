import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { skipUnchangedNightly } from '../screenshots-nightly-skip.mjs'

const sha = 'a'.repeat(40)
const other = 'b'.repeat(40)
const nightly = readFileSync(new URL('../../../.github/workflows/screenshots-nightly.yml', import.meta.url), 'utf8')

test('only a scheduled rerun of a successful SHA skips', () => {
  const success = [{ id: 1, head_sha: sha, conclusion: 'success' }]
  assert.equal(skipUnchangedNightly({
    eventName: 'schedule', sha, currentRunId: '9', runs: success,
  }), true)
  assert.equal(skipUnchangedNightly({
    eventName: 'schedule', sha, currentRunId: '1', runs: success,
  }), false)
  assert.equal(skipUnchangedNightly({
    eventName: 'schedule', sha: other, currentRunId: '9', runs: success,
  }), false)
  assert.equal(skipUnchangedNightly({
    eventName: 'schedule', sha, currentRunId: '9', runs: [{ id: 1, head_sha: sha, conclusion: 'failure' }],
  }), false)
  assert.equal(skipUnchangedNightly({
    eventName: 'workflow_dispatch', sha, currentRunId: '9', runs: success,
  }), false)
  assert.equal(skipUnchangedNightly({
    eventName: 'schedule', updateBaselines: true, sha, currentRunId: '9', runs: success,
  }), false)
  assert.equal(skipUnchangedNightly({
    eventName: 'schedule', sha: 'main', currentRunId: '9', runs: success,
  }), false)
  assert.equal(skipUnchangedNightly({
    eventName: 'schedule', sha, currentRunId: '9', runs: null,
  }), false)
})

test('the decide command fails closed when the API is unavailable', () => {
  const cli = spawnSync(process.execPath, [
    fileURLToPath(new URL('../screenshots-nightly-skip.mjs', import.meta.url)),
    '--decide',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: 'schedule',
      GITHUB_SHA: sha,
      GITHUB_REPOSITORY: 'raydocs/tono',
      GITHUB_RUN_ID: '1',
      PATH: '/usr/bin:/bin',
    },
  })
  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(cli.stdout, 'false')
})

test('nightly jobs stay unqueued when this SHA already succeeded', () => {
  assert.ok(nightly.includes('node tooling/scripts/screenshots-nightly-skip.mjs --decide'))
  const gate = "needs.skip-duplicate.result == 'success' && needs.skip-duplicate.outputs.skip != 'true'"
  for (const job of ['sing-box-input:', 'macos-window-captures:', 'ops-console-screenshots:']) {
    const at = nightly.indexOf(`\n  ${job}\n`)
    assert.ok(at > 0, job)
    const body = nightly.slice(at, at + 400)
    assert.ok(body.includes(gate), `${job} must stay unqueued when skip is true`)
  }
  assert.ok(nightly.includes('ops-console-rerecord:\n    if: ${{ inputs.update_baselines }}'))
  assert.ok(nightly.includes('skip-duplicate:\n    if: ${{ !inputs.update_baselines }}'))
})
