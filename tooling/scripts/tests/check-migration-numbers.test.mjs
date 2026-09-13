// A guard that cannot fail is worth nothing, so this feeds the checker a
// directory with a colliding prefix and insists on a non-zero exit, and a
// directory with a gap and insists on a warning that still exits 0.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../check-migration-numbers.mjs', import.meta.url))

/** A directory whose migrations folder holds exactly the given files. */
function withTree(files, run) {
  const root = mkdtempSync(path.join(tmpdir(), 'migration-numbers-'))
  try {
    for (const [relative, source] of Object.entries(files)) {
      const full = path.join(root, relative)
      mkdirSync(path.dirname(full), { recursive: true })
      writeFileSync(full, source)
    }
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function check(dir, extraArgs = []) {
  const result = spawnSync(process.execPath, [SCRIPT, '--dir', dir, ...extraArgs], {
    encoding: 'utf8',
  })
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const sql = 'SELECT 1;\n'

test('fails on a duplicate prefix at or above 0039', () => {
  withTree(
    {
      '0039_one.sql': sql,
      '0039_two.sql': sql,
      '0040_ok.sql': sql,
    },
    (dir) => {
      const result = check(dir)
      assert.equal(result.code, 1)
      assert.match(result.stderr, /duplicate migration prefixes/)
      assert.match(result.stderr, /0039_one\.sql/)
      assert.match(result.stderr, /0039_two\.sql/)
    },
  )
})

test('warns on a gap and still exits 0', () => {
  withTree(
    {
      '0039_start.sql': sql,
      '0041_skip.sql': sql,
    },
    (dir) => {
      const result = check(dir)
      assert.equal(result.code, 0)
      assert.match(result.stdout, /::warning::/)
      assert.match(result.stdout, /missing 0040/)
    },
  )
})

test('passes a contiguous unique sequence from 0039', () => {
  withTree(
    {
      '0039_a.sql': sql,
      '0040_b.sql': sql,
      '0041_c.sql': sql,
    },
    (dir) => {
      const result = check(dir)
      assert.equal(result.code, 0)
      assert.match(result.stdout, /unique and contiguous/)
      assert.doesNotMatch(result.stdout, /::warning::/)
    },
  )
})

// 0016/0017/0018 collisions are below the floor; they must not trip uniqueness.
test('ignores duplicate prefixes below 0039', () => {
  withTree(
    {
      '0016_a.sql': sql,
      '0016_b.sql': sql,
      '0039_ok.sql': sql,
    },
    (dir) => {
      const result = check(dir)
      assert.equal(result.code, 0)
      assert.doesNotMatch(result.stderr, /0016/)
    },
  )
})

test('--root points at a repository tree, not the migrations folder', () => {
  withTree(
    {
      'services/control-plane/migrations/0039_a.sql': sql,
      'services/control-plane/migrations/0039_b.sql': sql,
    },
    (root) => {
      try {
        execFileSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' })
        assert.fail('expected a non-zero exit')
      } catch (error) {
        assert.equal(error.status, 1)
        assert.match(error.stderr ?? '', /0039_a\.sql/)
      }
    },
  )
})
