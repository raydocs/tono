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
