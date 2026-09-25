#!/usr/bin/env node
// Reads the internal records as one view: per-delivery fragments plus the
// frozen history files they replaced.
//
//   node tooling/scripts/records.mjs changelog [--since YYYY-MM-DD]
//   node tooling/scripts/records.mjs findings [--status open|in-PR|fixed|refuted|accepted-design] [--id X]
//
// changelog: docs/changelog.d/*.md newest first, then the dated sections of
//            docs/INTERNAL_CHANGELOG.md.
// findings:  one table built from docs/FINDINGS_LEDGER.md rows, with each
//            docs/findings.d/*.md row replacing a ledger row of the same ID.
// --root DIR points at another repository root (used by the test).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HEADER = ['ID', '问题（一句）', '状态', 'Issue / PR', '等级', '剩余限制']
const DATE = /^(\d{4}-\d{2}-\d{2})/

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = { command }
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i]
    if (!key.startsWith('--') || i + 1 >= rest.length) throw new Error(`bad argument: ${key}`)
    options[key.slice(2)] = rest[++i]
  }
  return options
}

function fragmentFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map(name => ({ name, text: readFileSync(path.join(dir, name), 'utf8') }))
}

export function changelog(root, since) {
  const out = []
  const fragments = fragmentFiles(path.join(root, 'docs/changelog.d')).reverse()
  for (const { name, text } of fragments) {
    const date = name.match(DATE)?.[1]
    if (since && (!date || date < since)) continue
    out.push(text.trimEnd())
  }
  const frozen = readFileSync(path.join(root, 'docs/INTERNAL_CHANGELOG.md'), 'utf8')
  // Split before every dated level-2 heading; the preamble (rules, template) is dropped.
  const sections = frozen.split(/^(?=## \d{4}-\d{2}-\d{2})/m).filter(s => DATE.test(s.slice(3)))
  for (const section of sections) {
    if (since && section.slice(3, 13) < since) continue
    out.push(section.trimEnd())
  }
  return out.join('\n\n') + '\n'
}

function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim())
}

/** Data rows of every table in the text, normalised to the six ledger columns. */
function tableRows(text) {
  const rows = []
  let columns = null
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) { columns = null; continue }
    const c = cells(line)
    if (/^\|[\s:|-]+$/.test(line.trim())) continue // separator row
    if (c[0] === 'ID') { columns = c; continue }
    if (!columns) continue
    if (columns.length === 4) {
      // Refuted table: ID | 结论 | 状态 | 依据
      rows.push([c[0], c[1], c[2], '', '', c[3] ?? ''])
    } else {
      rows.push(HEADER.map((_, i) => c[i] ?? ''))
    }
  }
  return rows
}

export function findings(root, { status, id } = {}) {
  const byId = new Map()
  for (const row of tableRows(readFileSync(path.join(root, 'docs/FINDINGS_LEDGER.md'), 'utf8'))) {
    byId.set(row[0], row)
  }
  for (const { text } of fragmentFiles(path.join(root, 'docs/findings.d'))) {
    const [row] = tableRows(text)
    if (row) byId.set(row[0], row)
  }
  const rows = [...byId.values()].filter(row =>
    (!status || row[2].startsWith(status)) && (!id || row[0] === id))
  const line = r => `| ${r.join(' | ')} |`
  return [line(HEADER), line(HEADER.map(() => '---')), ...rows.map(line)].join('\n') + '\n'
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const root = options.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  if (options.command === 'changelog') {
    process.stdout.write(changelog(root, options.since))
  } else if (options.command === 'findings') {
    process.stdout.write(findings(root, options))
  } else {
    process.stderr.write('usage: records.mjs changelog [--since YYYY-MM-DD] | findings [--status S] [--id X]\n')
    process.exit(2)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.on('error', error => process.exit(error.code === 'EPIPE' ? 0 : 1))
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(2)
  }
}
