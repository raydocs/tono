import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../test-helper-peer-authorization.sh', import.meta.url))

function plan(env) {
  const summaryDir = mkdtempSync(path.join(tmpdir(), 'peer-auth-plan-'))
  const summary = path.join(summaryDir, 'summary.md')
  writeFileSync(summary, '')
  const result = spawnSync(script, ['--plan'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TONO_PEER_AUTH_IDENTITY: '',
      GITHUB_STEP_SUMMARY: summary,
      ...env,
    },
    timeout: 10000,
  })
  const summaryText = readFileSync(summary, 'utf8')
  rmSync(summaryDir, { recursive: true, force: true })
  return {
    status: result.status,
    signal: result.signal,
    stderr: result.stderr,
    stdout: result.stdout,
    summary: summaryText,
  }
}

test('a release without the Apple Development identity fails closed', () => {
  const explicit = plan({ TONO_PEER_AUTH_MODE: 'release', GITHUB_WORKFLOW_REF: '' })
  assert.equal(explicit.status, 1, explicit.stderr)
  assert.match(explicit.stderr, /release/)
  assert.doesNotMatch(explicit.stdout, /SKIP/)

  const inferred = plan({
    TONO_PEER_AUTH_MODE: '',
    GITHUB_WORKFLOW_REF: 'raydocs/tono/.github/workflows/macos-release.yml@refs/heads/release/macos',
  })
  assert.equal(inferred.status, 1, inferred.stderr)
  assert.match(inferred.stderr, /release/)
})

test('hosted ci runs the reject cases and records that the allow case did not', () => {
  const missing = plan({
    TONO_PEER_AUTH_MODE: 'ci',
    GITHUB_WORKFLOW_REF: 'raydocs/tono/.github/workflows/macos-ci.yml@refs/heads/main',
  })
  assert.equal(missing.status, 0, missing.stderr)
  assert.match(missing.stderr, /::warning/)
  assert.match(missing.stdout, /reject/)
  assert.match(missing.summary, /allow case did not run/)
  assert.doesNotMatch(missing.stdout, /^allow/m)

  const present = plan({
    TONO_PEER_AUTH_MODE: 'ci',
    TONO_PEER_AUTH_IDENTITY: 'ABCDEF0123456789',
  })
  assert.equal(present.status, 0, present.stderr)
  assert.equal(present.stderr, '')
  assert.match(present.stdout, /^allow/m)
  assert.equal(present.summary, '')
})
