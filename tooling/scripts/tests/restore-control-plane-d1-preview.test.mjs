import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

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

function isolatedRestoreFixture(t, databaseId = '11111111-1111-4111-8111-111111111111') {
  const dir = mkdtempSync(path.join(tmpdir(), 'restore-generated-preview-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const scripts = path.join(dir, 'tooling/scripts')
  const controlPlane = path.join(dir, 'services/control-plane')
  const bin = path.join(dir, 'bin')
  for (const directory of [scripts, controlPlane, bin]) mkdirSync(directory, { recursive: true })
  const script = path.join(scripts, path.basename(SCRIPT))
  copyFileSync(SCRIPT, script)
  chmodSync(script, 0o755)
  for (const name of ['wrangler.jsonc', 'wrangler.admin.jsonc']) {
    copyFileSync(path.join(CONTROL_PLANE, name), path.join(controlPlane, name))
  }
  const config = path.join(controlPlane, 'wrangler.preview.generated.jsonc')
  writeFileSync(config, JSON.stringify({ d1_databases: [{
    binding: 'DB', database_name: 'tono-control-plane-ops-preview', database_id: databaseId,
  }] }))
  const dump = gzipSync('CREATE TABLE fixture (id TEXT PRIMARY KEY);\n')
  writeFileSync(path.join(dir, 'backup.sql.gz'), dump)
  writeFileSync(path.join(dir, 'backup.sql.gz.sha256'), `${createHash('sha256').update(dump).digest('hex')}\n`)
  const calls = path.join(dir, 'calls.jsonl')
  const fakeNpx = path.join(bin, 'npx')
  writeFileSync(fakeNpx, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(__dirname);
const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify(args) + '\\n');
if (args.slice(0, 4).join(' ') === 'wrangler r2 object get') {
  const source = args[4].endsWith('.sha256') ? 'backup.sql.gz.sha256' : 'backup.sql.gz';
  fs.copyFileSync(path.join(root, source), args[args.indexOf('--file') + 1]);
} else if (args.slice(0, 3).join(' ') !== 'wrangler d1 execute' && args.slice(0, 4).join(' ') !== 'wrangler d1 migrations apply') {
  process.exit(99);
}
`)
  chmodSync(fakeNpx, 0o755)
  return { script, config, calls, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } }
}

test('restore applies pending migrations with the renderer-generated preview config', (t) => {
  const fixture = isolatedRestoreFixture(t)
  execFileSync(fixture.script, ['--no-wipe', 'fixture.sql.gz'], { env: fixture.env })
  const calls = readFileSync(fixture.calls, 'utf8').trim().split('\n').map(JSON.parse)
  assert.ok(calls.some((args) => args.slice(0, 3).join(' ') === 'wrangler d1 execute'))
  const migrations = calls.find((args) => args.slice(0, 4).join(' ') === 'wrangler d1 migrations apply')
  assert.ok(migrations, 'a successful generated-config restore must rehearse pending migrations')
  assert.equal(migrations[migrations.indexOf('--config') + 1], fixture.config)
})

test('restore refuses a generated preview config carrying a production database_id before remote calls', (t) => {
  const prod = readFileSync(path.join(CONTROL_PLANE, 'wrangler.jsonc'), 'utf8')
  const id = /"database_id"\s*:\s*"([^"]+)"/.exec(prod)[1]
  const fixture = isolatedRestoreFixture(t, id)
  assert.throws(
    () => execFileSync(fixture.script, ['--no-wipe', 'fixture.sql.gz'], { env: fixture.env, stdio: 'pipe' }),
    (error) => error.status === 1 && /production/.test(error.stderr.toString()),
  )
  assert.equal(existsSync(fixture.calls), false)
})
