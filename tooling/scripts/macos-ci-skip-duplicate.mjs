// A push of release/macos or release/windows fast-forwards onto a commit that
// is already on main. That push's path filter sees every file changed since
// the release branch last moved, so macOS CI queues four macos-26 runners for
// a tree main already tested commit by commit. Skip only that case.
//
// A commit that is not on main (a release-line hotfix, a merge commit) still
// runs. Any other event — pull_request via ci-gate, workflow_dispatch,
// workflow_call — still runs. A compare failure is not a skip.

import { pathToFileURL } from 'node:url'

export function skipDuplicateMacosCi({ event, ref, status, aheadBy }) {
  if (event !== 'push') return false
  if (ref !== 'refs/heads/release/macos' && ref !== 'refs/heads/release/windows') return false
  if (status !== 'identical' && status !== 'behind') return false
  const ahead = typeof aheadBy === 'number' ? aheadBy : Number(aheadBy)
  return Number.isInteger(ahead) && ahead === 0
}

function arg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1 || index + 1 >= process.argv.length) return ''
  return process.argv[index + 1]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const skip = skipDuplicateMacosCi({
    event: arg('--event'),
    ref: arg('--ref'),
    status: arg('--status'),
    aheadBy: arg('--ahead-by'),
  })
  process.stdout.write(skip ? 'true' : 'false')
}
