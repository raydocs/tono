// The rehearsal's additive gate must fail on a pending DROP / RENAME / NOT NULL
// column without DEFAULT, ignore the same words inside comments and strings,
// and ignore files at or below the production high-water mark.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../check-migrations-additive.mjs', import.meta.url))

test('flags only non-additive statements in migrations above the high-water mark', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'migrations-additive-'))
  try {
    writeFileSync(path.join(dir, '0095_old.sql'), 'DROP TABLE already_applied;\n')
    writeFileSync(
      path.join(dir, '0096_new_table.sql'),
      [
        '-- DROP TABLE users; RENAME in a comment is fine',
        "CREATE TABLE IF NOT EXISTS t (a TEXT CHECK (a <> 'DROP TABLE x'));",
        '/* ALTER TABLE users RENAME TO u */',
        'ALTER TABLE users ADD COLUMN flag INTEGER NOT NULL DEFAULT 0;',
        '',
      ].join('\n'),
    )
    writeFileSync(
      path.join(dir, '0097_rebuild.sql'),
      [
        'ALTER TABLE users RENAME COLUMN email TO mail;',
        'ALTER TABLE users ADD COLUMN plan TEXT NOT NULL;',
        'DROP INDEX users_email;',
        '',
      ].join('\n'),
    )
    const result = spawnSync(
      process.execPath,
      [SCRIPT, 'check', '--dir', dir, '--high-water', '0095'],
      { encoding: 'utf8' },
    )
    assert.equal(result.status, 1)
    assert.match(result.stdout, /pending migrations: 0096_new_table\.sql, 0097_rebuild\.sql/)
    const flagged = result.stderr
      .split('\n')
      .filter((line) => line.startsWith('  '))
      .map((line) => line.trim().replace(/: .*$/, ''))
    assert.deepEqual(flagged, ['0097_rebuild.sql:1', '0097_rebuild.sql:2', '0097_rebuild.sql:3'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
