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

test('a release uses the imported Developer ID identity and fails only when it is missing', () => {
  const missing = plan({ TONO_PEER_AUTH_MODE: 'release', GITHUB_WORKFLOW_REF: '' })
  assert.equal(missing.status, 1, missing.stderr)
  assert.match(missing.stderr, /Developer ID/)
  assert.doesNotMatch(missing.stderr, /Apple Development/)
  assert.doesNotMatch(missing.stdout, /SKIP/)

  const inferred = plan({
    TONO_PEER_AUTH_MODE: '',
    GITHUB_WORKFLOW_REF: 'raydocs/tono/.github/workflows/macos-release.yml@refs/heads/release/macos',
  })
  assert.equal(inferred.status, 1, inferred.stderr)
  assert.match(inferred.stderr, /Developer ID/)

  const imported = plan({
    TONO_PEER_AUTH_MODE: 'release',
    TONO_PEER_AUTH_IDENTITY: 'Developer ID Application: Tono (YY57758GS7)',
  })
  assert.equal(imported.status, 0, imported.stderr)
  assert.equal(imported.stderr, '')
  assert.match(imported.stdout, /^allow/m)

  const workflow = readFileSync(new URL('../../../.github/workflows/macos-release.yml', import.meta.url), 'utf8')
  const importAt = workflow.indexOf('Load the Developer ID identity')
  const peerAt = workflow.indexOf('Helper peer authorization')
  assert.ok(importAt > 0 && peerAt > importAt, workflow.slice(Math.max(peerAt, 0), peerAt + 200))
  assert.match(workflow.slice(peerAt, peerAt + 700), /secrets\.MACOS_DEVELOPER_ID_APPLICATION_IDENTITY/)
  const removeAt = workflow.indexOf('Remove the release keychain')
  assert.ok(removeAt > peerAt)

  const source = readFileSync(script, 'utf8')
  assert.match(source, /find-identity -v -p codesigning "\$release_keychain"/)
  assert.match(source, /release_keychain=\$\{KEYCHAIN_PATH:-\}/)
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
