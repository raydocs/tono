// Structure of the only workflow that holds both update signing keys at once.
// It must be unable to publish anything: no write token, no release, feed, bucket
// or promote step, and each private key reachable from exactly one job.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
// services-ci installs ops-console before running this glob; reuse its lockfile-pinned
// js-yaml rather than adding an unpinned parser.
const { load } = createRequire(path.join(root, 'services/ops-console/package.json'))('js-yaml')
const file = path.join(root, '.github/workflows/desktop-update-sign.yml')

let cached
function workflow() {
  cached ??= load(readFileSync(file, 'utf8'))
  return cached
}
const jobs = () => Object.entries(workflow().jobs)
const scripts = job => (job.steps ?? []).map(step => step.run ?? '').join('\n')

test('only an operator dispatch starts it', () => {
  assert.deepEqual(Object.keys(workflow().on), ['workflow_dispatch'])
})

test('the token can read contents and actions and nothing else', () => {
  assert.deepEqual(workflow().permissions, { contents: 'read', actions: 'read' })
  for (const [name, job] of jobs()) {
    assert.equal(job.permissions, undefined, `${name} must not replace the read-only token`)
  }
})

test('every job waits for the release/windows ref guard, which cannot be skipped', () => {
  const guard = workflow().jobs.guard
  assert.ok(guard, 'a guard job exists')
  assert.match(scripts(guard), /"\$GITHUB_REF" != refs\/heads\/release\/windows[\s\S]*?exit 1/)
  const needs = job => [job.needs ?? []].flat()
  const reaches = (name, seen = new Set()) => {
    if (name === 'guard') return true
    if (seen.has(name)) return false
    seen.add(name)
    return needs(workflow().jobs[name]).some(parent => reaches(parent, seen))
  }
  for (const [name, job] of jobs()) {
    // A skipped job counts as success, so a conditional guard or dependent could
    // let a wrong ref through while the run still reports green.
    assert.equal(job.if, undefined, `${name} has no job-level condition`)
    assert.equal(job['continue-on-error'], undefined, `${name} cannot fail open`)
    for (const step of job.steps ?? []) assert.equal(step['continue-on-error'], undefined, `${name} step cannot fail open`)
    if (name !== 'guard') assert.ok(reaches(name), `${name} depends on guard`)
  }
})

test('each signing key is visible to one step-level env in its own environment job', () => {
  const text = readFileSync(file, 'utf8')
  assert.doesNotMatch(text, /secrets\s*\[|toJSON\(\s*secrets|secrets:\s*inherit/)
  assert.equal(workflow().env, undefined, 'no workflow-level env')
  const owners = {
    SPARKLE_ED_PRIVATE_KEY: 'macos-appcast',
    TAURI_SIGNING_PRIVATE_KEY: 'windows-release',
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'windows-release',
  }
  const seen = {}
  for (const [name, job] of jobs()) {
    const referenced = [...JSON.stringify(job).matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map(match => match[1])
    assert.doesNotMatch(JSON.stringify(job.env ?? {}), /secrets\./, `${name} job env carries no secret`)
    for (const step of job.steps ?? []) {
      assert.doesNotMatch(`${step.run ?? ''}${JSON.stringify(step.with ?? {})}`, /secrets\./, `${name} passes secrets only via step env`)
    }
    for (const secret of referenced) {
      assert.ok(Object.hasOwn(owners, secret), `${name} references unexpected secret ${secret}`)
      assert.equal(job.environment, owners[secret], `${secret} is only in the ${owners[secret]} job`)
      seen[secret] = [...(seen[secret] ?? []), name]
    }
    if (job.environment) assert.ok(referenced.length > 0, `${name} requests ${job.environment} without using its key`)
  }
  for (const secret of Object.keys(owners)) assert.equal(seen[secret]?.length, 1, `${secret} appears in exactly one job`)
  assert.notEqual(seen.SPARKLE_ED_PRIVATE_KEY[0], seen.TAURI_SIGNING_PRIVATE_KEY[0], 'the two keys never share a job')
})

test('no step can release, upload to a bucket, promote, push or write through the API', () => {
  const allowed = new Set(['actions/checkout', 'actions/setup-node', 'actions/upload-artifact', 'pnpm/action-setup'])
  const forbidden = [
    /\bgh\s+release\b/, /\bgh\s+workflow\b/, /\bgh\s+run\s+(rerun|cancel)\b/, /\bgh\s+pr\b/,
    /\bgh\s+api\b[^\n]*\s(-X|--method|-f|-F|--field|--raw-field|--input)\b/,
    /\bcurl\b[^\n]*\s(-X|--request|-d|--data[a-z-]*|-T|--upload-file|-F|--form)\b/,
    /\bgit\s+(push|tag)\b/, /\bwrangler\b/, /\brclone\b/, /\baws\s+s3\b/,
    /upload-release-asset/, /windows-update-promote/, /node\s+\S*publish-macos-appcast\.mjs/,
  ]
  for (const [name, job] of jobs()) {
    assert.equal(job.uses, undefined, `${name} calls no reusable workflow`)
    for (const step of job.steps ?? []) {
      if (step.uses) {
        const [action, ref] = step.uses.split('@')
        assert.ok(allowed.has(action), `${name} uses unexpected action ${step.uses}`)
        assert.match(ref ?? '', /^[0-9a-f]{40}$/, `${step.uses} is pinned to a commit`)
      }
      for (const pattern of forbidden) assert.doesNotMatch(step.run ?? '', pattern, `${name}: ${step.name}`)
    }
  }
})
