import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CONNECT_BENCH_PATHS,
  aggregateStatus,
  changedFilesBetween,
  diffEndpoints,
  filtersFromRepo,
  isSha,
  matchingWorkflows,
  pushPathList,
} from '../ci-gate-changes.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const filters = filtersFromRepo(root)
const heavy = ['macos', 'windows', 'services', 'singBox', 'connectBench']

const MACOS_PATHS = [
  'apps/macos/**',
  'tooling/scripts/**',
  '.github/workflows/macos-ci.yml',
  'apps/windows/crates/tono-core/src/update_contract.rs',
  'apps/windows/crates/tono-core/tests/update_contract.rs',
]
const WINDOWS_PATHS = [
  'apps/windows/Cargo.toml',
  'apps/windows/Cargo.lock',
  'apps/windows/vendor/**',
  'apps/windows/crates/**',
  'apps/windows/service/**',
  'apps/windows/app/**',
  '.github/workflows/windows-ci.yml',
  '.github/workflows/windows-candidate.yml',
  '.github/workflows/windows-installer-smoke.yml',
  '.github/workflows/desktop-update-candidate.yml',
  'tooling/scripts/desktop-update-v1.mjs',
  'tooling/scripts/tests/desktop-update-v1.test.mjs',
  'tooling/scripts/test-windows-candidate-install.ps1',
  'tooling/scripts/tests/windows-ci-paths.test.cjs',
  'tooling/scripts/test-windows-qa.ps1',
  'tooling/scripts/tests/windows-qa-guards.Tests.ps1',
  'tooling/scripts/tests/fixtures/update-protocol-v1/**',
  'apps/macos/Tono/Models/UpdateContractV1.swift',
  'apps/macos/TonoTests/UpdateContractV1Tests.swift',
]
const SERVICES_PATHS = [
  'services/**',
  'ops-panel/**',
  'tooling/scripts/remote/**',
  'tooling/scripts/provision-tono-node.py',
  'tooling/scripts/tests/test_provision_tono_node.py',
  'tooling/scripts/generate-release-center.mjs',
  'tooling/scripts/tests/generate-release-center.test.mjs',
  'tooling/scripts/check-migration-numbers.mjs',
  'tooling/scripts/check-ops-budgets.mjs',
  'tooling/scripts/compare-connect-performance.mjs',
  'tooling/scripts/windows-package-components.mjs',
  'tooling/scripts/prune-merged-branches.mjs',
  'tooling/scripts/tests/*.test.mjs',
  'tooling/scripts/publish-managed-catalog.rb',
  'tooling/scripts/write-dedirock-hy2-catalog-sources.rb',
  'tooling/scripts/tests/publish-managed-catalog.test.rb',
  'tooling/scripts/provision-reality-node.rb',
  'tooling/scripts/tests/provision-reality-node.test.rb',
  'tooling/ops/hy2/**',
  '.github/workflows/services-ci.yml',
  '.github/workflows/desktop-update-sign.yml',
]
const SING_BOX_PATHS = [
  '.github/workflows/sing-box-alpha9-check.yml',
  'tooling/scripts/sing-box/**',
  'tooling/scripts/build-sing-box.sh',
]
const CONNECT_BENCH = [
  'tooling/perf/connect-bench/**',
  'apps/windows/crates/tono-core/src/config.rs',
  'apps/windows/service/src/core/runtime_generation/owned_config.rs',
  'apps/macos/Tono/Core/Configuration/ConfigPipeline+Runtime.swift',
  'apps/macos/Tono/Core/Configuration/ConfigPipeline+Nodes.swift',
  '.github/workflows/connect-bench.yml',
]

function workflow(name) {
  return readFileSync(path.join(root, '.github/workflows', name), 'utf8')
}

function calls(should, result) {
  return ['macos', 'windows', 'services', 'sing-box', 'connect-bench'].map((name) => ({ name, should, result }))
}

test('docs-only change skips every heavy workflow', () => {
  const selected = matchingWorkflows([
    'docs/BUILD_AND_TEST.md',
    'docs/changelog.d/2026-09-30-ci-gate.md',
    'AGENTS.md',
  ], filters)
  for (const key of heavy) assert.equal(selected[key], false, key)
  const problems = aggregateStatus({ changes: 'success', calls: calls('false', 'skipped') })
  assert.deepEqual(problems, [])
})

test('ci-gate reuses the workflows push path lists', () => {
  assert.deepEqual(filters.macos, MACOS_PATHS)
  assert.deepEqual(filters.windows, WINDOWS_PATHS)
  assert.deepEqual(filters.services, SERVICES_PATHS)
  assert.deepEqual(filters.singBox, SING_BOX_PATHS)
  assert.deepEqual(filters.connectBench, CONNECT_BENCH)
  assert.deepEqual(CONNECT_BENCH_PATHS, CONNECT_BENCH)
  const commented = `
on:
  push:
    paths:
      - services/**
      # kept
      - tooling/scripts/tests/*.test.mjs
jobs:
`
  assert.deepEqual(pushPathList(commented), ['services/**', 'tooling/scripts/tests/*.test.mjs'])
})

test('a touched path selects the workflow that lists it', () => {
  const macos = matchingWorkflows(['apps/macos/Tono/App.swift'], filters)
  assert.equal(macos.macos, true)
  assert.equal(macos.windows, false)
  assert.equal(macos.services, false)
  assert.equal(macos.singBox, false)
  assert.equal(macos.connectBench, false)

  const windows = matchingWorkflows(['apps/windows/app/README.md'], filters)
  assert.equal(windows.windows, true)
  assert.equal(windows.macos, false)

  const services = matchingWorkflows(['services/control-plane/src/index.ts'], filters)
  assert.equal(services.services, true)
  assert.equal(services.macos, false)

  const sing = matchingWorkflows(['tooling/scripts/sing-box/certify.py'], filters)
  assert.equal(sing.singBox, true)
  assert.equal(sing.macos, true)

  const bench = matchingWorkflows(['tooling/perf/connect-bench/bench.py'], filters)
  assert.equal(bench.connectBench, true)
  assert.equal(bench.macos, false)
  assert.equal(bench.windows, false)
})

test('aggregate fails when a relevant job failed or was cancelled', () => {
  assert.ok(aggregateStatus({ changes: 'success', calls: calls('true', 'failure') }).length > 0)
  assert.ok(aggregateStatus({ changes: 'success', calls: calls('true', 'cancelled') }).length > 0)
  assert.ok(aggregateStatus({ changes: 'failure', calls: calls('false', 'skipped') }).some((line) => line.includes('change detection')))
  assert.ok(aggregateStatus({ changes: 'cancelled', calls: calls('', 'cancelled') }).some((line) => line.includes('cancelled')))
  assert.ok(aggregateStatus({
    changes: 'success',
    calls: [{ name: 'macos', should: 'false', result: 'success' }],
  }).some((line) => line.includes('expected skipped')))
})

test('merge_group diffs its base and head SHAs', () => {
  const base = 'a'.repeat(40)
  const head = 'b'.repeat(40)
  const checkout = 'c'.repeat(40)
  assert.deepEqual(diffEndpoints('merge_group', { merge_group: { base_sha: base, head_sha: head } }, checkout), { base, head })
  assert.deepEqual(diffEndpoints('pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } }, checkout), {
    base,
    head: checkout,
  })
  assert.deepEqual(diffEndpoints('workflow_dispatch', {}, checkout), { all: true })
  assert.equal(isSha(base), true)
  assert.throws(() => changedFilesBetween('main', head))
  const here = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  assert.deepEqual(changedFilesBetween(here, here), [])
})

test('pull_request triggering moved into ci-gate', () => {
  const gate = workflow('ci-gate.yml')
  assert.match(gate, /^on:\n {2}pull_request:\n {2}merge_group:\n {4}types: \[checks_requested\]\n {2}workflow_dispatch:\n/m)
  assert.match(gate, /^ {2}ci-gate:\n {4}name: ci-gate\n {4}needs: \[changes, macos, windows, services, sing_box, connect_bench\]\n {4}if: always\(\)/m)
  assert.match(gate, /uses: \.\/\.github\/workflows\/macos-ci\.yml/)
  assert.match(gate, /uses: \.\/\.github\/workflows\/windows-ci\.yml/)
  assert.match(gate, /uses: \.\/\.github\/workflows\/services-ci\.yml/)
  assert.match(gate, /uses: \.\/\.github\/workflows\/sing-box-alpha9-check\.yml/)
  assert.match(gate, /uses: \.\/\.github\/workflows\/connect-bench\.yml/)
  assert.match(gate, /cancel-in-progress: \$\{\{ github\.event_name != 'merge_group' \}\}/)
  const keepCancel = "cancel-in-progress: ${{ github.event_name != 'merge_group' && github.event_name != 'workflow_call' }}"
  for (const name of ['macos-ci.yml', 'windows-ci.yml', 'services-ci.yml']) {
    const yaml = workflow(name)
    assert.doesNotMatch(yaml, /^ {2}pull_request:/m)
    assert.match(yaml, /^ {2}workflow_call:/m)
    assert.ok(yaml.includes(keepCancel), name)
  }
  for (const name of ['sing-box-alpha9-check.yml', 'connect-bench.yml']) {
    const yaml = workflow(name)
    assert.doesNotMatch(yaml, /^ {2}pull_request:/m)
    assert.match(yaml, /^ {2}workflow_call:/m)
    assert.doesNotMatch(yaml, /cancel-in-progress:/)
  }
  const pushBranches = 'push:\n    branches:\n      - main\n      - release/macos\n      - release/windows\n'
  for (const name of ['macos-ci.yml', 'windows-ci.yml', 'services-ci.yml', 'sing-box-alpha9-check.yml']) {
    assert.ok(workflow(name).includes(pushBranches), name)
  }
  assert.match(workflow('macos-ci.yml'), /^ {2}workflow_dispatch:/m)
  assert.match(workflow('connect-bench.yml'), /^ {2}workflow_dispatch:/m)
  assert.doesNotMatch(workflow('connect-bench.yml'), /^ {2}push:/m)
  assert.doesNotMatch(workflow('sing-box-alpha9-check.yml'), /^ {2}workflow_dispatch:/m)
})

test('aggregate command passes a docs-only skip and fails a cancelled job', () => {
  const script = path.join(root, 'tooling/scripts/ci-gate-changes.mjs')
  const base = {
    CHANGES: 'success',
    MACOS: 'skipped',
    MACOS_SHOULD: 'false',
    WINDOWS: 'skipped',
    WINDOWS_SHOULD: 'false',
    SERVICES: 'skipped',
    SERVICES_SHOULD: 'false',
    SING_BOX: 'skipped',
    SING_BOX_SHOULD: 'false',
    CONNECT_BENCH: 'skipped',
    CONNECT_BENCH_SHOULD: 'false',
  }
  const pass = spawnSync(process.execPath, [script, 'aggregate'], { env: { ...process.env, ...base }, encoding: 'utf8' })
  assert.equal(pass.status, 0, pass.stderr)
  assert.match(pass.stdout, /ci-gate pass/)
  const fail = spawnSync(process.execPath, [script, 'aggregate'], {
    env: { ...process.env, ...base, MACOS: 'cancelled', MACOS_SHOULD: 'true' },
    encoding: 'utf8',
  })
  assert.equal(fail.status, 1)
  assert.match(fail.stderr, /macos cancelled/)
})
