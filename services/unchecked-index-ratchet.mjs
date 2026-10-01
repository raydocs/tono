// Counts `error TS` lines from `tsc --noUncheckedIndexedAccess`.
// The existing strict `tsc --noEmit` stays a separate command and must still
// exit 0. This fails only when the indexed-access error count rises above
// the committed baseline. A lower count stays green so a cleanup is not blocked.
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// `./node_modules/.bin/tsc` is a shebang shim. On Windows the file next to it
// is `tsc.cmd`, and CreateProcess does not append PATHEXT when the path
// already contains a separator, so the shim fails with ENOENT. TypeScript 7
// does not export `./bin/tsc`, so the script is taken from the package bin
// field and run with this Node. A Windows runner that cannot resolve the
// package still launches `tsc.cmd`.
const BIN_SHIM = /^(.*[/\\]node_modules[/\\]\.bin[/\\])([^/\\]+)$/

export function resolveCommand(command, options = {}) {
  const platform = options.platform ?? process.platform
  const cwd = options.cwd ?? process.cwd()
  const executable = command[0]
  const args = command.slice(1)
  const shim = BIN_SHIM.exec(executable)
  if (!shim) return { file: executable, args, shell: false }
  const bare = shim[2].toLowerCase().endsWith('.cmd') ? shim[2].slice(0, -4) : shim[2]
  if (bare === 'tsc') {
    const script = typescriptBin(cwd)
    if (script) return { file: process.execPath, args: [script, ...args], shell: false }
  }
  if (platform === 'win32' && !shim[2].toLowerCase().endsWith('.cmd')) {
    return { file: `${executable}.cmd`, args, shell: true }
  }
  return { file: executable, args, shell: false }
}

function typescriptBin(cwd) {
  try {
    const require = createRequire(path.join(cwd, 'package.json'))
    const pkgPath = require.resolve('typescript/package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const rel = pkg.bin && (typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.tsc)
    if (typeof rel !== 'string' || rel === '') return null
    return path.join(path.dirname(pkgPath), rel)
  } catch {
    return null
  }
}

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
  const planned = resolveCommand(command)
  const result = spawnSync(planned.file, planned.args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: planned.shell,
    windowsHide: true,
  })
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
