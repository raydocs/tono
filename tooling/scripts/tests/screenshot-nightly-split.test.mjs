import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// D9-A: screenshot tests left the PR gate for screenshots-nightly.yml. A capture
// skipped in macos-ci.yml but missing from the nightly would run nowhere before
// a release, and a pixel comparison that loses --ignore-snapshots is back in the
// PR gate. Text, not YAML: the lists are xcodebuild/playwright arguments.
const workflow = (name) => readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8')
const ids = (yaml, flag) => new Set([...yaml.matchAll(new RegExp(`-${flag}:(\\S+)`, 'g'))].map((match) => match[1]))

test('every screenshot test the PR gate skips runs in the nightly, and only there', () => {
  const macos = workflow('macos-ci.yml')
  const services = workflow('services-ci.yml')
  const nightly = workflow('screenshots-nightly.yml')

  const skipped = ids(macos, 'skip-testing')
  assert.ok(skipped.size > 0, 'macos-ci.yml skips no screenshot test')
  assert.deepEqual(ids(nightly, 'only-testing'), skipped)
  assert.equal(ids(macos, 'only-testing').size, 0, 'the PR gate must not run a capture-only pass')

  assert.ok(/^ {8}run: npx playwright test --shard=.+ --ignore-snapshots$/m.test(services),
    'services-ci.yml (PR gate) must keep --ignore-snapshots on the Playwright shards')
  assert.ok(/^ {8}run: npx playwright test$/m.test(nightly), 'the nightly must compare the screenshot baselines')

  assert.ok(/^on:\n {2}schedule:\n {4}- cron: /m.test(nightly), 'the nightly needs a schedule')
  assert.ok(/^ {2}workflow_dispatch:/m.test(nightly), 'the nightly needs workflow_dispatch')
  assert.ok(!/^ {2}(pull_request|merge_group|workflow_call):/m.test(nightly), 'the nightly must stay out of the PR gate')
})

test('the nightly re-records baselines only when a dispatch asks for it', () => {
  const nightly = workflow('screenshots-nightly.yml')

  assert.ok(/^ {2}workflow_dispatch:\n {4}inputs:\n {6}update_baselines:\n(?: {8}.+\n)*? {8}default: false$/m.test(nightly),
    'update_baselines must be a dispatch input that defaults to false')
  const updates = [...nightly.matchAll(/^ {6}- name: .+\n {8}if: (.+)\n(?: {8}.*\n)*? {8}run: .*--update-snapshots.*$/gm)]
  assert.equal(updates.length, 1, 'exactly one step re-records baselines')
  assert.equal(updates[0][1], '${{ inputs.update_baselines }}')
  assert.equal([...nightly.matchAll(/--update-snapshots/g)].length, 1, 'no other step may re-record')
})
