import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const workflow = readFileSync(new URL('../../../.github/workflows/macos-ci.yml', import.meta.url), 'utf8')

function jobBody(name) {
  const marker = `\n  ${name}:\n`
  const at = workflow.indexOf(marker)
  assert.ok(at > 0, name)
  const rest = workflow.slice(at + marker.length)
  const next = rest.search(/\n {2}[a-z0-9-]+:\n/)
  return next === -1 ? rest : rest.slice(0, next)
}

test('macos-ci builds the privileged helper once and the other jobs install that artifact', () => {
  assert.equal([...workflow.matchAll(/build-core-helper\.sh/g)].length, 1)
  const helper = jobBody('helper')
  assert.match(helper, /tooling\/scripts\/build-core-helper\.sh/)
  assert.match(helper, /name: tono-core-helper\n/)
  assert.match(helper, /tono-core-helper\.built/)

  const consumers = "needs.sing-box-input.result == 'success' && needs.sing-box-input.outputs.skip != 'true' && needs.helper.result == 'success'"
  for (const name of ['build', 'unit-tests', 'privileged-tests']) {
    const body = jobBody(name)
    assert.match(body, /needs: \[sing-box-input, helper\]/)
    assert.ok(body.includes(consumers), name)
    assert.match(body, /name: tono-core-helper\n/)
    assert.match(body, /tono-core-helper\.built/)
    assert.equal(body.includes('build-core-helper.sh'), false, name)
  }

  const policy = jobBody('policy-tests')
  assert.match(policy, /needs: sing-box-input\n/)
  assert.equal(policy.includes('needs: [sing-box-input, helper]'), false)
  assert.equal(policy.includes('name: tono-core-helper'), false)
  assert.equal(policy.includes('build-core-helper.sh'), false)
})
