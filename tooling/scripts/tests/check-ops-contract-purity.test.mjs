// A guard that cannot fail is worth nothing, so this feeds the checker a tree
// with a forbidden import and insists on a non-zero exit and the offending
// line on stderr.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../check-ops-contract-purity.mjs', import.meta.url))
const OPS = 'services/control-plane/src/ops'

/** A minimal repository whose ops folder holds exactly the given files. */
function withTree(files, run) {
  const root = mkdtempSync(path.join(tmpdir(), 'ops-contract-purity-'))
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

function check(root) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

const pureTree = {
  [`${OPS}/contract.ts`]: "export * from './contract/vocabulary';\nexport const CONTRACT_VERSION = 1;\n",
  [`${OPS}/http.ts`]: "import { ApiError } from '../errors';\nexport const fail = () => new ApiError(400, 'X', 'y');\n",
  [`${OPS}/contract/vocabulary.ts`]: "export const TONES = ['ok'] as const;\n",
  [`${OPS}/contract/checkers.ts`]:
    "import { ApiError } from '../../errors';\nimport { TONES } from './vocabulary';\nexport const all = [ApiError, TONES];\n",
}

test('passes a contract that only imports errors and its siblings', () => {
  withTree(pureTree, (root) => {
    const result = check(root)
    assert.equal(result.code, 0)
    assert.match(result.stdout, /pure/)
  })
})

test('fails on a Worker type reaching into the contract', () => {
  withTree(
    { ...pureTree, [`${OPS}/contract/vocabulary.ts`]: "import type { Env } from '../../env';\nexport type X = Env;\n" },
    (root) => {
      const result = check(root)
      assert.equal(result.code, 1)
      assert.match(result.stderr, /contract\/vocabulary\.ts:1/)
      assert.match(result.stderr, /'\.\.\/\.\.\/env'/)
    },
  )
})

// The console imports this file directly; a D1 helper in it would drag the
// Worker runtime into a browser build.
test('fails on a sideways import into another ops module', () => {
  withTree(
    { ...pureTree, [`${OPS}/http.ts`]: "import { loadOperationsLive } from './live';\nexport const x = loadOperationsLive;\n" },
    (root) => {
      const result = check(root)
      assert.equal(result.code, 1)
      assert.match(result.stderr, /http\.ts:1/)
    },
  )
})

test('fails on a bare package import', () => {
  withTree(
    { ...pureTree, [`${OPS}/contract/checkers.ts`]: "import { z } from 'zod';\nexport const schema = z;\n" },
    (root) => {
      assert.equal(check(root).code, 1)
    },
  )
})

test('fails on a dynamic import', () => {
  withTree(
    {
      ...pureTree,
      [`${OPS}/contract/checkers.ts`]: "export const load = () => import('../../index');\n",
    },
    (root) => {
      const result = check(root)
      assert.equal(result.code, 1)
      assert.match(result.stderr, /index/)
    },
  )
})

// Prose about an import is not an import; a rule that trips on its own
// documentation gets deleted rather than obeyed.
test('ignores an import written in a comment', () => {
  withTree(
    {
      ...pureTree,
      [`${OPS}/contract/vocabulary.ts`]:
        "// Never write: import type { Env } from '../../env';\n/* nor import { DB } from '../db'; */\nexport const T = 1;\n",
    },
    (root) => {
      assert.equal(check(root).code, 0)
    },
  )
})
