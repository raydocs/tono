// Production's rules (fixture) send no api-relay-down recovery; adding the rule
// docs/ops/api-relay.md suggests fixes that; a D1 row with fire_on=open_resolve
// but the default one-hour cooldown does not.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../check-relay-alert-rule.mjs', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./fixtures/ops-alert-rules.json', import.meta.url))
const DOC = fileURLToPath(new URL('../../../docs/ops/api-relay.md', import.meta.url))

function check(data) {
  const dir = mkdtempSync(path.join(tmpdir(), 'relay-alert-rule-'))
  try {
    const file = path.join(dir, 'rules.json')
    writeFileSync(file, JSON.stringify(data))
    const result = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' })
    return { code: result.status, out: result.stdout + result.stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('reports whether a rule sends api-relay-down recoveries within the outage', () => {
  const production = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  const missing = check(production)
  assert.equal(missing.code, 1, missing.out)
  assert.match(missing.out, /skip 2dd81896-.* fire_on is open, not open_resolve/)
  assert.match(missing.out, /skip fixture-webhook-severe .* min severity severe is above warn/)
  assert.match(missing.out, /^MISSING: no enabled rule/m)
  assert.doesNotMatch(missing.out, /owner@example\.invalid/)

  // The rule body the doc tells the owner to create, verbatim.
  const suggested = JSON.parse(/-d '(\{"name":"API 中继".*?\})'/.exec(readFileSync(DOC, 'utf8'))[1])
  const added = check({
    ...production,
    items: [
      ...production.items,
      { id: 'new', enabled: true, matchSubjectType: null, matchSubjectId: null, minImpact: 0, delaySeconds: 0, ...suggested },
    ],
  })
  assert.equal(added.code, 0, added.out)
  assert.match(added.out, /^PASS new \(API 中继\): sends api-relay-down recoveries, cooldown 0s$/m)

  const d1 = check([
    {
      results: [
        {
          id: 'd1row', name: 'relay', enabled: 1, match_kind: 'api-relay-down', match_subject_type: null,
          match_subject_id: null, min_severity: 'warn', min_impact: 0, fire_on: 'open_resolve',
          delay_seconds: 0, cooldown_seconds: 3600,
        },
      ],
      success: true,
    },
  ])
  assert.equal(d1.code, 1, d1.out)
  assert.match(d1.out, /skip d1row \(relay\): cooldown 3600s is not shorter than a 300s outage/)
})
