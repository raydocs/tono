const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../../..')
// Use the application's frozen dependency, not an extra unpinned YAML parser.
const { load } = createRequire(path.join(root, 'apps/windows/app/package.json'))('js-yaml')
const workflow = load(readFileSync(path.join(root, '.github/workflows/windows-ci.yml'), 'utf8'))

for (const event of ['push', 'pull_request']) {
  test(`${event}: Windows CI covers workspace pins and vendor-only edits`, () => {
    const paths = workflow.on[event].paths
    for (const required of [
      'apps/windows/Cargo.toml',
      'apps/windows/Cargo.lock',
      'apps/windows/vendor/**',
      'apps/windows/crates/**',
      'apps/windows/service/**',
      'apps/windows/app/**',
      '.github/workflows/windows-ci.yml',
      '.github/workflows/windows-candidate.yml',
      '.github/workflows/windows-installer-smoke.yml',
      'tooling/scripts/test-windows-candidate-install.ps1',
      'tooling/scripts/tests/windows-ci-paths.test.cjs',
      'tooling/scripts/test-windows-qa.ps1',
      'tooling/scripts/tests/windows-qa-guards.Tests.ps1',
    ]) assert.ok(paths.includes(required), `${event} omits ${required}`)

    for (const changed of [
      'apps/windows/Cargo.toml',
      'apps/windows/Cargo.lock',
      'apps/windows/vendor/sysproxy/src/lib.rs',
      'apps/windows/vendor/kode-bridge/Cargo.toml',
      'apps/windows/crates/tono-core/src/policy.rs',
    ]) assert.ok(paths.some(pattern => path.matchesGlob(changed, pattern)), changed)

    assert.ok(!paths.some(pattern => path.matchesGlob('docs/architecture.md', pattern)),
      'unrelated documentation should not trigger the native Windows matrix')
  })
}

test('the frontend job actually executes this trigger regression test', () => {
  assert.ok(Object.values(workflow.jobs).some(job => job.steps?.some(step =>
    step['working-directory'] === 'apps/windows/app' &&
    step.run?.includes('node --test ../../../tooling/scripts/tests/windows-ci-paths.test.cjs'))))
})


test('the native Service job executes safe QA fault-targeting regressions', () => {
  assert.ok(workflow.jobs.service.steps.some(step =>
    step.shell === 'pwsh' && step.run?.includes('tooling/scripts/tests/windows-qa-guards.Tests.ps1')))
})

test('native updater adapters run in hosted lanes with nonzero Windows test guards', () => {
  const mac = load(readFileSync(path.join(root, '.github/workflows/macos-ci.yml'), 'utf8'))
  const helper = mac.jobs['privileged-tests']
  assert.equal(helper['runs-on'], 'macos-26')
  const selfTest = helper.steps.find(step => step.run === 'sudo apps/macos/Tono/Resources/tono-core-helper --update-self-test')
  assert.ok(selfTest)
  assert.equal(selfTest.if, undefined)
  assert.notEqual(selfTest['continue-on-error'], true)
  assert.equal(workflow.jobs.service['runs-on'], 'windows-2025')
  const native = workflow.jobs.service.steps.find(step => step.name === 'Test native update admission and independent executor')
  assert.equal(native?.['working-directory'], 'apps/windows/service')
  assert.equal(native.shell, 'pwsh')
  assert.equal(native.if, undefined)
  assert.notEqual(native['continue-on-error'], true)
  for (const prefix of ['update_transaction::tests::update_', 'core::update::tests::update_', 'update_executor::tests::update_']) {
    assert.ok(native.run.includes(prefix))
  }
  for (const target of ['--lib', '--bin tono-service-install']) {
    assert.ok(native.run.includes(`cargo test --locked --features standalone,client ${target} $filter -- --list`))
    assert.ok(native.run.includes(`cargo test --locked --features standalone,client ${target} $filter -- --nocapture`))
  }
  assert.ok(native.run.includes('Native update tests are missing'))
  assert.ok(native.run.includes('Independent executor tests are missing'))
  assert.ok(native.run.includes('$LASTEXITCODE -ne 0'))
})

test('Windows runs the dependency journal integration tests explicitly', () => {
  const job = workflow.jobs['app-rust']
  assert.equal(job['runs-on'], 'windows-2025')
  const step = job.steps.find(step => step.run === 'cargo test --locked -p tono-core --test update_journal_atomic')
  assert.ok(step, 'Tauri tests do not execute dependency integration tests')
  assert.equal(step['working-directory'], 'apps/windows')
  assert.equal(step.if, undefined)
  assert.notEqual(step['continue-on-error'], true)
})

test('Windows executes journal phase and persistence regressions with a nonzero-test guard', () => {
  const job = workflow.jobs['app-rust']
  assert.equal(job['runs-on'], 'windows-2025')
  const step = job.steps.find(step => step.run?.includes("$filter = 'update_journal::tests::'"))
  assert.ok(step, 'dependency unit tests currently execute only on Ubuntu')
  assert.equal(step['working-directory'], 'apps/windows')
  assert.equal(step.shell, 'pwsh')
  assert.equal(step.if, undefined)
  assert.notEqual(step['continue-on-error'], true)
  assert.ok(step.run.includes('cargo test --locked -p tono-core --lib $filter -- --list'))
  assert.ok(step.run.includes('cargo test --locked -p tono-core --lib $filter -- --nocapture'))
  for (const required of [
    'only_verified_commit_can_remove_journal',
    'owner_replay_advances_in_order_and_crash_at_each_phase_never_commits',
    'first_launch_reentry_preserves_durable_recovery_progress',
  ]) assert.ok(step.run.includes(required), `missing regression enumeration guard: ${required}`)
  assert.ok(step.run.includes('$LASTEXITCODE -ne 0'))
  assert.ok(step.run.includes('Expected journal regression is missing'))
})

test('shared update contract changes execute both native implementations and reject zero tests', () => {
  const mac = load(readFileSync(path.join(root, '.github/workflows/macos-ci.yml'), 'utf8'))
  for (const event of ['push', 'pull_request']) {
    for (const changed of [
      'tooling/scripts/tests/fixtures/update-protocol-v1/manifest.json',
      'apps/macos/Tono/Models/UpdateContractV1.swift',
      'apps/macos/TonoTests/UpdateContractV1Tests.swift',
      'apps/windows/crates/tono-core/src/update_contract.rs',
      'apps/windows/crates/tono-core/tests/update_contract.rs',
    ]) {
      assert.ok(workflow.on[event].paths.some(pattern => path.matchesGlob(changed, pattern)), `Windows omits ${changed}`)
      assert.ok(mac.on[event].paths.some(pattern => path.matchesGlob(changed, pattern)), `macOS omits ${changed}`)
    }
  }
  const step = workflow.jobs['app-rust'].steps.find(step =>
    step.run?.includes("$test = 'shared_wire_and_ownership_contract'"))
  assert.equal(step?.['working-directory'], 'apps/windows')
  assert.equal(step.shell, 'pwsh')
  assert.equal(step.if, undefined)
  assert.notEqual(step['continue-on-error'], true)
  assert.ok(step.run.includes('cargo test --locked -p tono-core --test update_contract -- --list'))
  assert.ok(step.run.includes('cargo test --locked -p tono-core --test update_contract $test -- --exact --nocapture'))
  assert.ok(step.run.includes('Shared update contract test is missing'))
  assert.ok(step.run.includes('$LASTEXITCODE -ne 0'))
  const native = mac.jobs.build.steps.find(step => step.env?.TEST_RUNNER_TONO_EMIT_UPDATE_CONTRACT)
  assert.ok(native?.run.includes('xcodebuild'))
  const guard = mac.jobs.build.steps.find(step => step.run?.includes('result.read_text() == hashlib.sha256'))
  assert.ok(guard?.run.includes('update-contract-v1-result.txt'))
  assert.equal(guard.if, undefined)
  assert.notEqual(guard['continue-on-error'], true)
})

test('Windows candidate build and installer smoke agree with the product version', () => {
  const version = JSON.parse(readFileSync(path.join(root, 'apps/windows/app/package.json'), 'utf8')).version
  const candidate = load(readFileSync(path.join(root, '.github/workflows/windows-candidate.yml'), 'utf8'))
  const smoke = load(readFileSync(path.join(root, '.github/workflows/windows-installer-smoke.yml'), 'utf8'))
  const steps = candidate.jobs.build.steps
  const gate = steps.find(step => step.run?.includes('verify-desktop-version.py'))
  assert.equal(gate.run.match(/verify-desktop-version\.py --expected (\S+)/)?.[1], version)
  const artifact = steps.find(step => step.uses?.startsWith('actions/upload-artifact@')).with.name
  assert.equal(artifact, `tono-windows-${version}-candidate-` + '${{ github.sha }}')
  const fetch = smoke.jobs['install-repair-uninstall'].steps.find(step => step.run?.includes('gh run download'))
  assert.ok(fetch.run.includes(`--name "tono-windows-${version}-candidate-$source"`))
  const installer = readFileSync(path.join(root, 'tooling/scripts/test-windows-candidate-install.ps1'), 'utf8')
  assert.equal(installer.match(/\$manifest\.version -ne '([^']+)'/)?.[1], version)
})

test('paired candidates share one source and sequence without granting signing or publication', () => {
  const read = name => load(readFileSync(path.join(root, '.github/workflows', name), 'utf8'))
  const pair = read('desktop-update-candidate.yml')
  const mac = read('macos-ci.yml')
  const win = read('windows-candidate.yml')
  assert.deepEqual(Object.keys(pair.on), ['workflow_dispatch'])
  assert.deepEqual(pair.permissions, { contents: 'read' })
  assert.equal(pair.jobs.macos.uses, './.github/workflows/macos-ci.yml')
  assert.equal(pair.jobs.windows.uses, './.github/workflows/windows-candidate.yml')
  assert.deepEqual(pair.jobs.macos.with, pair.jobs.windows.with)
  assert.equal(pair.jobs.macos.with.update_release_sequence, '${{ needs.inputs.outputs.sequence }}')
  assert.deepEqual(pair.jobs.pair.needs, ['inputs', 'macos', 'windows'])
  for (const value of [pair, mac, win]) {
    assert.ok(!JSON.stringify(value).includes('secrets.'), 'unsigned candidate must not gain signing credentials')
    for (const job of Object.values(value.jobs)) {
      if (job['runs-on']) assert.ok(['ubuntu-24.04', 'macos-26', 'windows-2025'].includes(job['runs-on']))
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with?.ref, undefined, 'native jobs must build the caller SHA')
      }
    }
  }
  for (const [value, id] of [[mac, 'macos-arm64'], [win, 'windows-x86_64']]) {
    assert.equal(value.on.workflow_call.inputs.update_release_sequence.required, true)
    assert.equal(value.jobs.build.env.TONO_UPDATE_RELEASE_SEQUENCE, "${{ inputs.update_release_sequence || '' }}")
    const step = value.jobs.build.steps.find(step => step.run?.includes(`--target ${id}`))
    assert.ok(step?.run.includes('desktop-update-v1.mjs measure'))
    assert.ok(step.run.includes('GITHUB_SHA'))
    assert.ok(step.run.includes(`update-target.${id}.json`))
  }
  for (const [name, job] of [['macos-release.yml', 'build'], ['windows-release.yml', 'build-draft']]) {
    const release = read(name)
    assert.equal(release.on.workflow_dispatch.inputs.update_release_sequence.type, 'string')
    assert.equal(release.jobs[job].env.TONO_UPDATE_RELEASE_SEQUENCE, "${{ inputs.update_release_sequence || '' }}")
  }
  const assembly = pair.jobs.pair.steps.find(step => step.run?.includes('desktop-update-v1.mjs assemble'))
  assert.ok(assembly?.run.includes('--source "$GITHUB_SHA"'))
  assert.ok(assembly.run.includes('manifest.unsigned.json'))
  assert.ok(workflow.jobs.app.steps.some(step => step.run?.includes('node --test ../../../tooling/scripts/tests/desktop-update-v1.test.mjs')))
  for (const event of ['push', 'pull_request']) {
    for (const changed of ['.github/workflows/desktop-update-candidate.yml', 'tooling/scripts/desktop-update-v1.mjs', 'tooling/scripts/tests/desktop-update-v1.test.mjs']) {
      assert.ok(workflow.on[event].paths.some(pattern => path.matchesGlob(changed, pattern)), changed)
    }
  }
})
