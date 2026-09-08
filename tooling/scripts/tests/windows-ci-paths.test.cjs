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
      'tooling/scripts/tests/windows-ci-paths.test.cjs',
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
