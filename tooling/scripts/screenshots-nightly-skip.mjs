// Skip a scheduled screenshots-nightly run when this SHA already succeeded.
// workflow_dispatch (including baseline re-record) always runs. An API
// failure or a missing SHA does not skip.

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function skipUnchangedNightly({ eventName, updateBaselines, sha, currentRunId, runs }) {
  if (eventName !== 'schedule') return false
  if (updateBaselines === true || updateBaselines === 'true') return false
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/i.test(sha)) return false
  if (!Array.isArray(runs)) return false
  return runs.some((run) => {
    if (!run || run.conclusion !== 'success') return false
    const head = run.head_sha || run.headSha
    if (head !== sha) return false
    const id = run.id ?? run.databaseId
    if (currentRunId && id != null && String(id) === String(currentRunId)) return false
    return true
  })
}

function listSuccessfulRuns(repo) {
  const out = execFileSync(
    'gh',
    ['api', `repos/${repo}/actions/workflows/screenshots-nightly.yml/runs?per_page=30`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const parsed = JSON.parse(out)
  return Array.isArray(parsed.workflow_runs) ? parsed.workflow_runs : []
}

export function decideFromEnv(env = process.env) {
  const eventName = env.GITHUB_EVENT_NAME || ''
  const updateBaselines = env.UPDATE_BASELINES || ''
  const sha = env.GITHUB_SHA || ''
  const repo = env.GITHUB_REPOSITORY || ''
  const currentRunId = env.GITHUB_RUN_ID || ''
  if (eventName !== 'schedule') return false
  if (!repo || !sha) return false
  try {
    return skipUnchangedNightly({
      eventName,
      updateBaselines,
      sha,
      currentRunId,
      runs: listSuccessfulRuns(repo),
    })
  } catch (error) {
    process.stderr.write(`screenshots-nightly skip lookup failed; running (${error.message})\n`)
    return false
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const skip = process.argv.includes('--decide') ? decideFromEnv() : false
  process.stdout.write(skip ? 'true' : 'false')
}
