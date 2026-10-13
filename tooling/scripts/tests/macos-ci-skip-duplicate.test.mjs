import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { skipDuplicateMacosCi } from '../macos-ci-skip-duplicate.mjs'

const workflow = readFileSync(new URL('../../../.github/workflows/macos-ci.yml', import.meta.url), 'utf8')

test('a release-branch push skips only when that commit is already on main', () => {
  const onMain = { event: 'push', ref: 'refs/heads/release/macos', status: 'identical', aheadBy: 0 }
  assert.equal(skipDuplicateMacosCi(onMain), true)
  assert.equal(skipDuplicateMacosCi({ ...onMain, ref: 'refs/heads/release/windows', status: 'behind' }), true)
  assert.equal(skipDuplicateMacosCi({ ...onMain, status: 'ahead', aheadBy: 3 }), false)
  assert.equal(skipDuplicateMacosCi({ ...onMain, status: 'diverged', aheadBy: 1 }), false)
  assert.equal(skipDuplicateMacosCi({ ...onMain, status: 'unknown', aheadBy: 1 }), false)
  assert.equal(skipDuplicateMacosCi({ ...onMain, event: 'workflow_dispatch' }), false)
  assert.equal(skipDuplicateMacosCi({ ...onMain, event: 'pull_request' }), false)
  assert.equal(skipDuplicateMacosCi({ ...onMain, ref: 'refs/heads/main' }), false)

  const cli = spawnSync(process.execPath, [
    fileURLToPath(new URL('../macos-ci-skip-duplicate.mjs', import.meta.url)),
    '--event', 'push',
    '--ref', 'refs/heads/release/macos',
    '--status', 'identical',
    '--ahead-by', '0',
  ], { encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(cli.stdout, 'true')

  const run = "needs.sing-box-input.result == 'success' && needs.sing-box-input.outputs.skip != 'true'"
  for (const job of ['build:', 'unit-tests:', 'policy-tests:', 'privileged-tests:']) {
    const at = workflow.indexOf(`\n  ${job}\n`)
    assert.ok(at > 0, job)
    const body = workflow.slice(at, at + 500)
    assert.ok(body.includes(run), `${job} must stay unqueued when the release push is already on main`)
  }
  assert.ok(workflow.includes('node tooling/scripts/macos-ci-skip-duplicate.mjs'))
  assert.ok(workflow.includes("if: steps.decide.outputs.skip != 'true'"))
})
