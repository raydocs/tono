// The nightly D1 backup failed every night for weeks with nobody told (#208).
// A failed backup must open (or comment on) one tracking issue without needing
// the Cloudflare secrets that are missing, and the dump must still never leave
// Cloudflare: no artifact upload, and only the alert job may write issues.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
// services-ci installs ops-console before running this glob; reuse its lockfile-pinned js-yaml.
const { load } = createRequire(path.join(root, 'services/ops-console/package.json'))('js-yaml')
const source = readFileSync(path.join(root, '.github/workflows/control-plane-d1-backup.yml'), 'utf8')

test('a failed backup opens one tracking issue without Cloudflare secrets or artifacts', () => {
  const workflow = load(source)
  const { backup, alert } = workflow.jobs
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  assert.equal(backup.permissions, undefined, 'the backup job keeps the read-only token')
  assert.deepEqual(alert.permissions, { issues: 'write' })
  assert.equal(alert.needs, 'backup')
  assert.equal(alert.if, '${{ always() }}')
  assert.doesNotMatch(JSON.stringify(alert), /secrets\.|actions\/checkout/)
  assert.doesNotMatch(source, /upload-artifact/)

  const dir = mkdtempSync(path.join(tmpdir(), 'tono-d1-alert-'))
  try {
    const log = path.join(dir, 'gh.log')
    // Stub gh: record every call (RS-separated; the body spans lines); `issue list`
    // prints nothing, so no alert issue is open yet.
    writeFileSync(path.join(dir, 'gh'), `#!/bin/sh\nprintf '%s\\036' "$*" >> "${log}"\n`)
    chmodSync(path.join(dir, 'gh'), 0o755)
    execFileSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', alert.steps[0].run], {
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        ...alert.env,
        BACKUP_RESULT: 'failure',
        RUN_URL: 'https://example.invalid/run/1',
        DOC_URL: 'https://example.invalid/doc',
      },
    })
    const calls = readFileSync(log, 'utf8').split('\x1e').slice(0, -1)
    assert.equal(calls.length, 3, calls.join('\n---\n'))
    assert.match(calls[0], /^label create d1-backup-failure --force /)
    assert.match(calls[1], /^issue list --label d1-backup-failure --state open /)
    assert.match(
      calls[2],
      /^issue create --title Control plane D1 backup is failing --label d1-backup-failure --body Control plane D1 backup run ended with `failure` at .*https:\/\/example\.invalid\/run\/1/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
