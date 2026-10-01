import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('large workflow input preserves registration checks without broken pipes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'tono-suite-reachability-'))
  try {
    const scripts = path.join(root, 'tooling/scripts')
    const workflows = path.join(root, '.github/workflows')
    mkdirSync(scripts, { recursive: true })
    mkdirSync(workflows, { recursive: true })
    const script = path.join(scripts, 'test-suite-reachability.sh')
    copyFileSync(fileURLToPath(new URL('../test-suite-reachability.sh', import.meta.url)), script)
    writeFileSync(path.join(scripts, 'test-macos-all.sh'), '# aggregate\n')
    writeFileSync(path.join(scripts, 'test-wired.sh'), '# fixture\n')
    const workflow = path.join(workflows, 'checks.yml')
    const guard = 'run: tooling/scripts/test-suite-reachability.sh\n'
    const padding = 'name: unrelated workflow step\n'.repeat(20000)
    writeFileSync(workflow, guard + 'run: tooling/scripts/test-wired.sh\n' + padding)
    const run = () => spawnSync('bash', [script], { encoding: 'utf8', timeout: 10000 })

    const wired = run()
    assert.equal(wired.status, 0, wired.stderr)
    assert.match(wired.stdout, /2\/2 suites are wired/)
    assert.equal(wired.stderr, '')

    writeFileSync(workflow, guard + padding)
    const unwired = run()
    assert.equal(unwired.status, 1, unwired.stderr)
    assert.match(unwired.stderr, /tooling\/scripts\/test-wired\.sh/)
    assert.doesNotMatch(unwired.stderr, /Broken pipe/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
