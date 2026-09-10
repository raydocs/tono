import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CycleError,
  chunk,
  flattenSqliteMasterJson,
  parseReferences,
  planDrops,
  quoteIdent,
} from '../wipe-d1-in-order.mjs'

const SCRIPT = fileURLToPath(new URL('../wipe-d1-in-order.mjs', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./fixtures/wipe-d1-sqlite-master.json', import.meta.url))
const REPO_ROOT = path.resolve(path.dirname(SCRIPT), '..', '..')
const CONTROL_PLANE = path.resolve(REPO_ROOT, 'services', 'control-plane')

function row(type, name, sql, tblName = name) {
  return { type, name, tbl_name: tblName, sql }
}

function tableSql(name, refs) {
  const cols = refs.map((ref) => `x TEXT REFERENCES ${ref}`).join(', ')
  return `CREATE TABLE ${name} (${cols || 'id TEXT PRIMARY KEY'})`
}

function dropNames(statements, kind) {
  const re = new RegExp(`^DROP ${kind} IF EXISTS "(.*)";$`)
  return statements.flatMap((stmt) => {
    const m = re.exec(stmt)
    if (!m) return []
    return [m[1].replaceAll('""', '"')]
  })
}

function run(args, extra = {}) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      env: extra.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return {
      code: error.status,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    }
  }
}

function runWithSimpleNpx(args, envExtra = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wipe-d1-npx-'))
  try {
    const bin = path.join(dir, 'bin')
    mkdirSync(bin)
    const marker = path.join(dir, 'npx-invoked')
    const argvLog = path.join(dir, 'npx-argv')
    writeFileSync(
      path.join(bin, 'npx'),
      `#!/bin/sh
printf 'invoked\\n' > ${JSON.stringify(marker)}
printf '%s\\n' "$@" > ${JSON.stringify(argvLog)}
exit 99
`,
    )
    chmodSync(path.join(bin, 'npx'), 0o755)
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, ...envExtra }
    if (envExtra.TONO_ALLOW_PRODUCTION_WIPE === undefined) {
      delete env.TONO_ALLOW_PRODUCTION_WIPE
    }
    const result = run(args, { env })
    return {
      ...result,
      invoked: existsSync(marker),
      argv: existsSync(argvLog) ? readFileSync(argvLog, 'utf8').trimEnd().split('\n').filter(Boolean) : [],
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function installRecordingNpx(dir) {
  const bin = path.join(dir, 'bin')
  mkdirSync(bin)
  const logPath = path.join(dir, 'npx-log.jsonl')
  const applyCountPath = path.join(dir, 'apply-count')
  const sqliteMasterPath = path.join(dir, 'sqlite-master.json')
  const recorderPath = path.join(dir, 'npx-recorder.cjs')
  writeFileSync(
    recorderPath,
    `'use strict'
const fs = require('fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.WIPE_NPX_LOG, JSON.stringify({ argv: args, cwd: process.cwd() }) + '\\n')
const isJson = args.includes('--json')
const cmdIdx = args.indexOf('--command')
const command = cmdIdx >= 0 ? args[cmdIdx + 1] : ''
if (isJson) {
  if (command === 'SELECT type, name FROM sqlite_master') {
    const leftover = process.env.WIPE_LEFTOVER || ''
    const results = leftover
      ? [{ type: 'table', name: leftover }]
      : [
          { type: 'table', name: '_cf_KV' },
          { type: 'table', name: 'sqlite_sequence' },
        ]
    process.stdout.write(JSON.stringify([{ results }]))
    process.exit(0)
  }
  process.stdout.write(fs.readFileSync(process.env.WIPE_SQLITE_MASTER, 'utf8'))
  process.exit(0)
}
const failAt = Number(process.env.WIPE_FAIL_APPLY || '0')
if (failAt > 0) {
  const countPath = process.env.WIPE_APPLY_COUNT
  let n = 0
  try { n = Number(fs.readFileSync(countPath, 'utf8')) } catch {}
  n += 1
  fs.writeFileSync(countPath, String(n))
  if (n === failAt) process.exit(1)
}
process.exit(0)
`,
  )
  writeFileSync(
    path.join(bin, 'npx'),
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(recorderPath)} "$@"\n`,
  )
  chmodSync(path.join(bin, 'npx'), 0o755)
  return { bin, logPath, applyCountPath, sqliteMasterPath }
}

function recordingEnv(stub, extra = {}) {
  const env = {
    ...process.env,
    PATH: `${stub.bin}${path.delimiter}${process.env.PATH}`,
    WIPE_NPX_LOG: stub.logPath,
    WIPE_SQLITE_MASTER: stub.sqliteMasterPath,
    WIPE_APPLY_COUNT: stub.applyCountPath,
    ...extra,
  }
  if (extra.TONO_ALLOW_PRODUCTION_WIPE === undefined) {
    delete env.TONO_ALLOW_PRODUCTION_WIPE
  }
  return env
}

function readNpxLog(logPath) {
  if (!existsSync(logPath)) return []
  const text = readFileSync(logPath, 'utf8').trim()
  if (!text) return []
  return text.split('\n').map((line) => JSON.parse(line))
}

function sqliteMasterTables(names) {
  return JSON.stringify([
    {
      results: names.map((name) => ({
        type: 'table',
        name,
        tbl_name: name,
        sql: `CREATE TABLE ${name} (id TEXT PRIMARY KEY)`,
      })),
    },
  ])
}

function assertApplyArgv(call, database) {
  assert.equal(call.cwd, CONTROL_PLANE)
  assert.ok(call.argv.includes('--remote'))
  assert.ok(call.argv.includes('-y'))
  assert.ok(call.argv.includes('--command'))
  assert.equal(call.argv.includes('--json'), false)
  assert.deepEqual(call.argv.slice(0, 4), ['wrangler', 'd1', 'execute', database])
}

test('children drop before parents across a 3-level chain', () => {
  const rows = [
    row('table', 'a', tableSql('a', [])),
    row('table', 'b', tableSql('b', ['a(id)'])),
    row('table', 'c', tableSql('c', ['b(id)'])),
  ]
  const { tables } = planDrops(rows)
  assert.deepEqual(tables, ['c', 'b', 'a'])
})

test('two independent chains keep children before parents', () => {
  const rows = [
    row('table', 'a', tableSql('a', [])),
    row('table', 'b', tableSql('b', ['a(id)'])),
    row('table', 'c', tableSql('c', ['b(id)'])),
    row('table', 'y', tableSql('y', [])),
    row('table', 'z', tableSql('z', ['y(id)'])),
  ]
  const { tables } = planDrops(rows)
  assert.ok(tables.indexOf('c') < tables.indexOf('b'))
  assert.ok(tables.indexOf('b') < tables.indexOf('a'))
  assert.ok(tables.indexOf('z') < tables.indexOf('y'))
  assert.equal(tables.length, 5)
})

test('parses quoted, bracketed, backticked, and bare identifiers', () => {
  const sql = `CREATE TABLE child (
    a TEXT REFERENCES "Parent Table"(id),
    b TEXT REFERENCES \`FooBar\`(id),
    c TEXT REFERENCES [Bracketed](id),
    d TEXT REFERENCES bare_name(id)
  )`
  const parents = [...parseReferences('child', sql)].sort()
  assert.deepEqual(parents, ['Bracketed', 'FooBar', 'Parent Table', 'bare_name'])
})

test('parses column-level and table-level REFERENCES', () => {
  const column = `CREATE TABLE devices (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
  )`
  assert.deepEqual([...parseReferences('devices', column)], ['users'])

  const tableLevel = `CREATE TABLE operations_deployments (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES operations_servers(id) ON DELETE RESTRICT,
    logical_node_id TEXT,
    FOREIGN KEY(logical_node_id, server_id)
      REFERENCES operations_logical_nodes(id, server_id) ON DELETE RESTRICT
  )`
  const parents = [...parseReferences('operations_deployments', tableLevel)].sort()
  assert.deepEqual(parents, ['operations_logical_nodes', 'operations_servers'])
})

test('ignores self-references', () => {
  const sql = `CREATE TABLE ops_incidents (
    id TEXT PRIMARY KEY,
    parent_incident_id TEXT REFERENCES ops_incidents(id) ON DELETE SET NULL
  )`
  assert.deepEqual([...parseReferences('ops_incidents', sql)], [])
})

test('ignores REFERENCES inside SQL comments', () => {
  const sql = `CREATE TABLE t (
    x TEXT -- REFERENCES hidden(id)
    /* REFERENCES also_hidden(id) */
    y TEXT REFERENCES visible(id)
  )`
  assert.deepEqual([...parseReferences('t', sql)], ['visible'])
})

test('cycle names both tables', () => {
  const rows = [
    row('table', 'alpha', tableSql('alpha', ['beta(id)'])),
    row('table', 'beta', tableSql('beta', ['alpha(id)'])),
  ]
  assert.throws(
    () => planDrops(rows),
    (error) => {
      assert.ok(error instanceof CycleError)
      assert.deepEqual(error.tables, ['alpha', 'beta'])
      assert.ok(error.message.includes('alpha'))
      assert.ok(error.message.includes('beta'))
      return true
    },
  )
})

test('triggers before indexes before tables', () => {
  const rows = [
    row('table', 't', tableSql('t', [])),
    row('index', 't_idx', 'CREATE INDEX t_idx ON t(id)', 't'),
    row('trigger', 't_trg', 'CREATE TRIGGER t_trg AFTER INSERT ON t BEGIN SELECT 1; END', 't'),
  ]
  const kinds = planDrops(rows).statements.map((s) => s.split(' ')[1])
  assert.deepEqual(kinds, ['TRIGGER', 'INDEX', 'TABLE'])
})

test('views drop after triggers and before indexes', () => {
  const rows = [
    row('table', 't', tableSql('t', [])),
    row('index', 't_idx', 'CREATE INDEX t_idx ON t(id)', 't'),
    row('trigger', 't_trg', 'CREATE TRIGGER t_trg AFTER INSERT ON t BEGIN SELECT 1; END', 't'),
    row('view', 't_view', 'CREATE VIEW t_view AS SELECT 1', 't_view'),
  ]
  const kinds = planDrops(rows).statements.map((s) => s.split(' ')[1])
  assert.deepEqual(kinds, ['TRIGGER', 'VIEW', 'INDEX', 'TABLE'])
  assert.equal(planDrops(rows).counts.views, 1)
})

test('excludes _cf_KV and sqlite_sequence even when present', () => {
  const rows = [
    row('table', '_cf_KV', 'CREATE TABLE _cf_KV (key TEXT PRIMARY KEY)'),
    row('table', 'sqlite_sequence', 'CREATE TABLE sqlite_sequence(name,seq)'),
    row('table', 'users', tableSql('users', [])),
  ]
  const { tables, statements } = planDrops(rows)
  assert.deepEqual(tables, ['users'])
  assert.equal(statements.some((s) => s.includes('_cf_KV')), false)
  assert.equal(statements.some((s) => s.includes('sqlite_sequence')), false)
})

test('d1_migrations is dropped by default and kept when requested', () => {
  const rows = [
    row('table', 'd1_migrations', 'CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY)'),
    row('table', 'users', tableSql('users', [])),
  ]
  assert.deepEqual(planDrops(rows).tables.sort(), ['d1_migrations', 'users'])
  assert.deepEqual(planDrops(rows, { keep: ['d1_migrations'] }).tables, ['users'])
})

test('chunk of N leaves a shorter last batch', () => {
  const batches = chunk(['a', 'b', 'c', 'd', 'e'], 2)
  assert.deepEqual(batches, [['a', 'b'], ['c', 'd'], ['e']])
})

test('quotes identifiers that embed a double quote', () => {
  assert.equal(quoteIdent('weird"name'), '"weird""name"')
  const { statements } = planDrops([row('table', 'weird"name', tableSql('x', []))])
  assert.deepEqual(statements, ['DROP TABLE IF EXISTS "weird""name";'])
})

test('real schema fixture drops children before parents', () => {
  const payload = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  const rows = flattenSqliteMasterJson(payload)
  const plan = planDrops(rows)
  const tables = plan.tables
  const idx = (name) => {
    const i = tables.indexOf(name)
    assert.ok(i >= 0, `expected ${name} in drop order, got ${tables.join(', ')}`)
    return i
  }
  assert.ok(idx('sessions') < idx('devices'))
  assert.ok(idx('devices') < idx('users'))
  assert.ok(idx('sessions') < idx('users'))
  assert.ok(idx('ops_incident_events') < idx('ops_incidents'))
  for (const name of [
    'users',
    'devices',
    'sessions',
    'exit_nodes',
    'ops_incidents',
    'ops_incident_events',
    'ops_node_status',
    'ops_node_status_history',
    'd1_migrations',
  ]) {
    idx(name)
  }
  assert.equal(tables.includes('_cf_KV'), false)
  assert.equal(tables.includes('sqlite_sequence'), false)

  const kinds = plan.statements.map((s) => s.split(' ')[1])
  const firstIndex = kinds.indexOf('INDEX')
  const firstTable = kinds.indexOf('TABLE')
  const lastTrigger = kinds.lastIndexOf('TRIGGER')
  assert.ok(lastTrigger < firstIndex)
  assert.ok(firstIndex < firstTable)
  assert.deepEqual(planDrops(rows, { keep: ['d1_migrations'] }).tables.includes('d1_migrations'), false)
})

test('--help fits in 25 lines and names the production gates', () => {
  const result = run(['--help'])
  assert.equal(result.code, 0)
  const lines = result.stdout.replace(/\n$/, '').split('\n')
  assert.ok(lines.length <= 25, `help has ${lines.length} lines`)
  assert.match(result.stdout, /--from-json/)
  assert.match(result.stdout, /--from-database/)
  assert.match(result.stdout, /--keep d1_migrations/)
  assert.match(result.stdout, /sqlite_\*/)
  assert.match(result.stdout, /_cf_\*/)
  assert.match(result.stdout, /--i-mean-production/)
  assert.match(result.stdout, /TONO_ALLOW_PRODUCTION_WIPE/)
  assert.match(result.stdout, /restore must not keep/)
})

test('cycle via --from-json exits 2 and names both tables', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wipe-d1-cycle-'))
  try {
    const file = path.join(dir, 'cycle.json')
    writeFileSync(
      file,
      JSON.stringify([
        row('table', 'alpha', tableSql('alpha', ['beta(id)'])),
        row('table', 'beta', tableSql('beta', ['alpha(id)'])),
      ]),
    )
    const result = run(['--plan', '--from-json', file])
    assert.equal(result.code, 2)
    assert.match(result.stderr, /alpha/)
    assert.match(result.stderr, /beta/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--batch 0 is a usage error', () => {
  const result = run(['--plan', '--from-json', FIXTURE, '--batch', '0'])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /--batch/)
})

test('--apply against tono-control-plane without gates exits 1 before wrangler', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wipe-d1-npx-'))
  try {
    const bin = path.join(dir, 'bin')
    mkdirSync(bin)
    const marker = path.join(dir, 'npx-invoked')
    writeFileSync(
      path.join(bin, 'npx'),
      `#!/bin/sh\nprintf 'invoked\\n' > "${marker}"\nexit 99\n`,
    )
    chmodSync(path.join(bin, 'npx'), 0o755)
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` }
    delete env.TONO_ALLOW_PRODUCTION_WIPE
    const result = run(['--apply', '--database', 'tono-control-plane'], { env })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /tono-control-plane/)
    assert.equal(existsSync(marker), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--apply against tono-control-plane with --i-mean-production alone is refused', () => {
  const result = runWithSimpleNpx(['--apply', '--database', 'tono-control-plane', '--i-mean-production'])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /tono-control-plane/)
  assert.equal(result.invoked, false)
})

test('--apply against tono-control-plane with TONO_ALLOW_PRODUCTION_WIPE=1 alone is refused', () => {
  const result = runWithSimpleNpx(['--apply', '--database', 'tono-control-plane'], {
    TONO_ALLOW_PRODUCTION_WIPE: '1',
  })
  assert.equal(result.code, 1)
  assert.match(result.stderr, /tono-control-plane/)
  assert.equal(result.invoked, false)
})

test('--apply against tono-control-plane with both gates invokes wrangler', () => {
  const result = runWithSimpleNpx(
    ['--apply', '--database', 'tono-control-plane', '--i-mean-production'],
    { TONO_ALLOW_PRODUCTION_WIPE: '1' },
  )
  assert.equal(result.code, 1)
  assert.equal(result.invoked, true)
  assert.match(result.stderr, /failed to load sqlite_master/)
  assert.deepEqual(result.argv.slice(0, 8), [
    'wrangler',
    'd1',
    'execute',
    'tono-control-plane',
    '--remote',
    '--json',
    '-y',
    '--command',
  ])
  assert.match(result.argv[8] ?? '', /sqlite_master/)
})

test('--apply stops at the first failed batch and exits 4', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wipe-d1-apply-fail-'))
  try {
    const stub = installRecordingNpx(dir)
    writeFileSync(stub.sqliteMasterPath, sqliteMasterTables(['alpha_t', 'beta_t', 'gamma_t']))
    const result = run(
      ['--apply', '--database', 'wipe-test-db', '--batch', '1'],
      { env: recordingEnv(stub, { WIPE_FAIL_APPLY: '2' }) },
    )
    assert.equal(result.code, 4)
    assert.match(result.stderr, /batch failed/)
    assert.match(result.stderr, /DROP TABLE IF EXISTS "beta_t";/)
    const calls = readNpxLog(stub.logPath)
    assert.equal(calls.length, 3)
    assert.ok(calls[0].argv.includes('--json'))
    assert.equal(calls[0].cwd, CONTROL_PLANE)
    const applyCalls = calls.filter((call) => !call.argv.includes('--json'))
    assert.equal(applyCalls.length, 2)
    for (const call of applyCalls) assertApplyArgv(call, 'wipe-test-db')
    assert.match(applyCalls[1].argv.at(-1) ?? '', /beta_t/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--apply exits 3 when sqlite_master still has leftovers', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wipe-d1-apply-leftover-'))
  try {
    const stub = installRecordingNpx(dir)
    writeFileSync(stub.sqliteMasterPath, sqliteMasterTables(['alpha_t', 'beta_t', 'gamma_t']))
    const result = run(
      ['--apply', '--database', 'wipe-test-db', '--batch', '1'],
      { env: recordingEnv(stub, { WIPE_LEFTOVER: 'stray_table' }) },
    )
    assert.equal(result.code, 3)
    assert.match(result.stderr, /leftover objects after apply/)
    assert.match(result.stderr, /stray_table/)
    const calls = readNpxLog(stub.logPath)
    assert.equal(calls.length, 5)
    assert.ok(calls[0].argv.includes('--json'))
    assert.ok(calls[4].argv.includes('--json'))
    const applyCalls = calls.filter((call) => !call.argv.includes('--json'))
    assert.equal(applyCalls.length, 3)
    for (const call of applyCalls) assertApplyArgv(call, 'wipe-test-db')
    assert.equal(calls[4].cwd, CONTROL_PLANE)
    assert.match(calls[4].argv.at(-1) ?? '', /SELECT type, name FROM sqlite_master/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--plan --from-json prints triggers then indexes then tables in batches of 10', () => {
  const result = run(['--plan', '--from-json', FIXTURE])
  assert.equal(result.code, 0)
  const blocks = result.stdout.trimEnd().split('\n\n')
  assert.ok(blocks.length >= 2)
  const first = blocks[0].split('\n')
  assert.equal(first.length, 10)
  assert.ok(first[0].startsWith('DROP TRIGGER'))
  const lastBlock = blocks[blocks.length - 1].split('\n')
  assert.ok(lastBlock.length <= 10)
  const all = result.stdout.split('\n').filter((line) => line.startsWith('DROP '))
  const kinds = all.map((line) => line.split(' ')[1])
  assert.ok(kinds.lastIndexOf('TRIGGER') < kinds.indexOf('INDEX'))
  assert.ok(kinds.lastIndexOf('INDEX') < kinds.indexOf('TABLE'))
  const tableLines = all.filter((line) => line.startsWith('DROP TABLE'))
  const pos = (name) => tableLines.findIndex((line) => line.includes(`"${name}"`))
  assert.ok(pos('sessions') < pos('devices'))
  assert.ok(pos('devices') < pos('users'))
})
