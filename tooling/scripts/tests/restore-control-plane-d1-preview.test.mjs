import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../restore-control-plane-d1-preview.sh', import.meta.url))
const CONTROL_PLANE = path.resolve(path.dirname(SCRIPT), '..', '..', 'services', 'control-plane')
const PREVIEW_CONFIG = path.join(CONTROL_PLANE, 'wrangler.preview.jsonc')

test('restore refuses a preview config that still carries the production database_id', () => {
  const prod = readFileSync(path.join(CONTROL_PLANE, 'wrangler.jsonc'), 'utf8')
  const id = /"database_id"\s*:\s*"([^"]+)"/.exec(prod)?.[1]
  assert.ok(id)
  const existed = existsSync(PREVIEW_CONFIG)
  const previous = existed ? readFileSync(PREVIEW_CONFIG, 'utf8') : null
  const dir = mkdtempSync(path.join(tmpdir(), 'restore-preview-'))
  const bin = path.join(dir, 'bin')
  const marker = path.join(dir, 'npx-invoked')
  mkdirSync(bin)
  writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\nprintf 'invoked\\n' > ${JSON.stringify(marker)}\nexit 99\n`)
  chmodSync(path.join(bin, 'npx'), 0o755)
  writeFileSync(
    PREVIEW_CONFIG,
    `{
  "d1_databases": [{
    "binding": "DB",
    "database_name": "tono-control-plane-ops-preview",
    "database_id": "${id}"
  }]
}
`,
  )
  try {
    let result
    try {
      const stdout = execFileSync(
        SCRIPT,
        ['backups/control-plane-d1/2026-09-09T03:17:05Z.sql.gz'],
        {
          encoding: 'utf8',
          env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      result = { code: 0, stdout, stderr: '' }
    } catch (error) {
      result = { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
    }
    assert.equal(result.code, 1)
    assert.match(result.stderr, new RegExp(id))
    assert.match(result.stderr, /production/)
    assert.equal(existsSync(marker), false)
  } finally {
    if (existed) writeFileSync(PREVIEW_CONFIG, previous)
    else rmSync(PREVIEW_CONFIG, { force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})
