// Counts `error TS` lines from `tsc --noUncheckedIndexedAccess`.
// The existing strict `tsc --noEmit` stays a separate command and must still
// exit 0. This fails only when the indexed-access error count rises above
// the committed baseline. A lower count stays green so a cleanup is not blocked.
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function countTypeScriptErrors(output) {
  return String(output).split('\n').filter((line) => /error TS\d+:/.test(line)).length
}

export function readBaseline(text) {
  const line = String(text).split('\n').map((row) => row.trim()).find((row) => row && !row.startsWith('#'))
  const value = Number(line)
  if (!Number.isInteger(value) || value < 0) throw new Error('baseline must be a non-negative integer')
  return value
}

export function ratchetResult(count, baseline) {
  if (count > baseline) {
    return { ok: false, message: `unchecked indexed access errors rose from ${baseline} to ${count}` }
  }
  return { ok: true, message: `unchecked indexed access errors ${count} (baseline ${baseline})` }
}

function main() {
  const args = process.argv.slice(2)
  const baselineFlag = args.indexOf('--baseline')
  const sep = args.indexOf('--')
  if (baselineFlag < 0 || !args[baselineFlag + 1] || sep < 0 || sep >= args.length - 1) {
    console.error('usage: unchecked-index-ratchet.mjs --baseline <file> -- <command> [args]')
    process.exit(2)
  }
  const baseline = readBaseline(readFileSync(args[baselineFlag + 1], 'utf8'))
  const command = args.slice(sep + 1)
  const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.error || result.status === null) {
    console.error(result.error?.message ?? 'compiler produced no status')
    process.exit(2)
  }
  const count = countTypeScriptErrors(output)
  if (result.status !== 0 && count === 0) {
    console.error(output)
    process.exit(result.status)
  }
  const decision = ratchetResult(count, baseline)
  console.log(decision.message)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${decision.message}\n`)
  }
  if (!decision.ok) {
    const lines = output.trim().split('\n')
    console.error(lines.slice(-80).join('\n'))
    process.exit(1)
  }
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === entry) main()
