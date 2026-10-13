import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { pushPathList } from '../ci-gate-changes.mjs'
import {
  classifyMacosDiff,
  macosSuitePassed,
  skipDuplicateMacosCi,
} from '../macos-ci-skip-duplicate.mjs'

const workflow = readFileSync(new URL('../../../.github/workflows/macos-ci.yml', import.meta.url), 'utf8')
const patterns = pushPathList(workflow)

function passedChecks(prefix = '') {
  return ['build', 'unit-tests', 'policy-tests', 'privileged-tests'].map((name) => ({
    name: `${prefix}${name}`,
    conclusion: 'success',
  }))
}

test('a release-branch push skips only when that commit is already on main', () => {
  const onMain = { event: 'push', ref: 'refs/heads/release/macos', status: 'identical', aheadBy: 0 }
  assert.equal(skipDuplicateMacosCi(onMain), true)
  assert.equal(skipDuplicateMacosCi({ ...onMain, ref: 'refs/heads/release/windows', status: 'behind' }), true)
  assert.equal(skipDuplicateMacosCi({ ...onMain, status: 'ahead', aheadBy: 3 }), false)
  assert.equal(skipDuplicateMacosCi({ ...onMain, status: 'diverged', aheadBy: 1 }), false)
  assert.equal(skipDuplicateMacosCi({ ...onMain, status: 'unknown', aheadBy: 1 }), false)
  assert.equal(skipDuplicateMacosCi({ ...onMain, event: 'workflow_dispatch' }), false)
  assert.equal(skipDuplicateMacosCi({ ...onMain, event: 'pull_request' }), false)
  assert.equal(skipDuplicateMacosCi({ ...onMain, event: 'workflow_call' }), false)
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
    assert.ok(body.includes(run), `${job} must stay unqueued when skip is true`)
  }
  assert.ok(workflow.includes('node tooling/scripts/macos-ci-skip-duplicate.mjs --decide'))
  assert.ok(workflow.includes("if: steps.decide.outputs.skip != 'true'"))
})

test('a main push skips only when this SHA or an unchanged macOS merge parent already passed', () => {
  const base = { event: 'push', ref: 'refs/heads/main' }
  assert.equal(skipDuplicateMacosCi({ ...base, suiteOnSha: true }), true)
  assert.equal(skipDuplicateMacosCi({
    ...base, parents: 2, macosDiff: 'empty', suiteOnParent: true,
  }), true)
  assert.equal(skipDuplicateMacosCi({
    ...base, parents: 2, macosDiff: 'changed', suiteOnParent: true,
  }), false)
  assert.equal(skipDuplicateMacosCi({
    ...base, parents: 2, macosDiff: 'unknown', suiteOnParent: true,
  }), false)
  assert.equal(skipDuplicateMacosCi({
    ...base, parents: 2, macosDiff: 'empty', suiteOnParent: false,
  }), false)
  assert.equal(skipDuplicateMacosCi({
    ...base, parents: 1, macosDiff: 'empty', suiteOnParent: true,
  }), false)
  assert.equal(skipDuplicateMacosCi({ ...base, parents: 2, macosDiff: 'empty' }), false)
  assert.equal(skipDuplicateMacosCi({ ...base, event: 'workflow_dispatch', suiteOnSha: true }), false)

  const cli = spawnSync(process.execPath, [
    fileURLToPath(new URL('../macos-ci-skip-duplicate.mjs', import.meta.url)),
    '--event', 'push',
    '--ref', 'refs/heads/main',
    '--parents', '2',
    '--macos-diff', 'empty',
    '--suite-on-parent', 'true',
  ], { encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(cli.stdout, 'true')
})

test('macOS path classification uses the workflow push list and fails closed', () => {
  assert.equal(classifyMacosDiff({
    files: ['docs/agent-reports/2026-10-13-ci-runner-queue.md'],
    truncated: false,
    patterns,
  }), 'empty')
  assert.equal(classifyMacosDiff({
    files: ['apps/macos/Tono/Views/MenuBarView.swift', 'docs/readme.md'],
    truncated: false,
    patterns,
  }), 'changed')
  assert.equal(classifyMacosDiff({
    files: ['tooling/scripts/tests/macos-ci-skip-duplicate.test.mjs'],
    truncated: false,
    patterns,
  }), 'changed')
  assert.equal(classifyMacosDiff({ files: [], truncated: true, patterns }), 'unknown')
  assert.equal(classifyMacosDiff({ files: null, truncated: false, patterns }), 'unknown')
  assert.equal(classifyMacosDiff({
    files: ['docs/readme.md'],
    truncated: false,
    patterns: ['apps/macos/*'],
  }), 'unknown')
})

test('a path-skipped or partial suite is not a prior pass', () => {
  assert.equal(macosSuitePassed(passedChecks(), ''), true)
  assert.equal(macosSuitePassed(passedChecks('macos / '), ''), true)
  assert.equal(macosSuitePassed([{ name: 'macos', conclusion: 'skipped' }], ''), false)
  const missing = passedChecks().filter((check) => check.name !== 'privileged-tests')
  assert.equal(macosSuitePassed(missing, ''), false)
  const failed = passedChecks()
  failed[0] = { ...failed[0], conclusion: 'failure' }
  assert.equal(macosSuitePassed(failed, ''), false)
  const current = 'https://github.com/raydocs/tono/actions/runs/99/job/1'
  const prior = 'https://github.com/raydocs/tono/actions/runs/50/job/1'
  const rerun = [
    ...passedChecks().map((check) => ({ ...check, conclusion: '', details_url: current })),
    ...passedChecks().map((check) => ({ ...check, details_url: prior })),
  ]
  assert.equal(macosSuitePassed(rerun, '99'), true)
  assert.equal(macosSuitePassed([
    { name: 'unit-tests', conclusion: '', details_url: 'https://github.com/raydocs/tono/actions/runs/7/job/1' },
    { name: 'unit-tests', conclusion: 'success' },
    ...passedChecks().filter((check) => check.name !== 'unit-tests'),
  ], ''), false)
})
