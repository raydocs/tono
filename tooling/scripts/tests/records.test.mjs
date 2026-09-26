// The records reader must put fragments ahead of the frozen history and let a
// finding fragment override the ledger row with the same ID.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../records.mjs', import.meta.url))

test('fragments come first and override ledger rows by ID', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'records-'))
  try {
    const files = {
      'docs/INTERNAL_CHANGELOG.md': '# log\n\n## 维护规则\nrules\n\n## 2026-09-20 · old entry\n- body\n',
      'docs/changelog.d/README.md': '# not an entry\n',
      'docs/changelog.d/2026-09-24-a.md': '## 2026-09-24 · middle\n',
      'docs/changelog.d/2026-09-25-b.md': '## 2026-09-25 · newest\n',
      'docs/FINDINGS_LEDGER.md': [
        '| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |',
        '|---|---|---|---|---|---|',
        '| A1 | first | in-PR | #1 | 低·推导 | — |',
        '| A2 | second | open | 待开 | 中·推导 | — |',
        '',
        '| ID | 结论 | 状态 | 依据 |',
        '|---|---|---|---|',
        '| X9 | withdrawn | refuted | reason |',
        '',
      ].join('\n'),
      'docs/findings.d/A1.md': '| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |\n|---|---|---|---|---|---|\n| A1 | first | fixed(abc123) | #1 | 低·推导 | — |\n\nnote\n',
      'docs/findings.d/B1.md': '| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |\n|---|---|---|---|---|---|\n| B1 | new | open | 待开 | 低·推导 | — |\n',
    }
    for (const [relative, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      writeFileSync(path.join(root, relative), text)
    }
    const run = (...args) => {
      const result = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      return result.stdout
    }

    const headings = run('changelog').split('\n').filter(l => l.startsWith('## '))
    assert.deepEqual(headings, ['## 2026-09-25 · newest', '## 2026-09-24 · middle', '## 2026-09-20 · old entry'])
    assert.deepEqual(run('changelog', '--since', '2026-09-24').split('\n').filter(l => l.startsWith('## ')),
      ['## 2026-09-25 · newest', '## 2026-09-24 · middle'])

    const ids = out => out.split('\n').slice(2).filter(Boolean).map(l => l.split('|')[1].trim())
    assert.deepEqual(ids(run('findings', '--status', 'open')), ['A2', 'B1'])
    assert.match(run('findings', '--id', 'A1'), /\| A1 \| first \| fixed\(abc123\) \|/)
    assert.deepEqual(ids(run('findings', '--status', 'refuted')), ['X9'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
