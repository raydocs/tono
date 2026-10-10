#!/usr/bin/env node
// Static and local-database checks for the control-plane migration rehearsal
// (tooling/scripts/rehearse-control-plane-migrations.sh). Ops plan §2 rule 1:
// migrations only add. A pending migration (numeric prefix above the
// production high-water mark) may create tables, indexes, triggers and add
// columns; it may not drop or rename anything that already exists.
//
// Subcommands (no network, no wrangler; the shell script runs wrangler):
//   check    --dir <migrations> --high-water <NNNN>
//            Lists pending files and fails on DROP, RENAME, or an
//            ADD COLUMN ... NOT NULL without DEFAULT (that one fails on any
//            non-empty production table).
//   pending  --dir <migrations> --high-water <NNNN>
//            Prints the names of migrations at or below the high-water mark,
//            one per line (the files the seeded state is built from).
//   snapshot --persist <wrangler --persist-to dir> --out <file.json>
//            Reads the single local D1 sqlite file read-only and writes every
//            table's columns and row count.
//   compare  --before <a.json> --after <b.json> [--same-schema]
//            Fails when a table or column in `before` is missing from `after`,
//            or a row count changed. --same-schema also requires identical
//            table/column sets (fresh vs seeded end state).

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Replace comments and quoted strings with spaces, keeping newlines and offsets. */
export function blankCommentsAndStrings(sql) {
  let out = ''
  let i = 0
  const blank = (s) => s.replace(/[^\n]/g, ' ')
  while (i < sql.length) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? sql.length : end
      out += blank(sql.slice(i, stop))
      i = stop
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? sql.length : end + 2
      out += blank(sql.slice(i, stop))
      i = stop
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2
            continue
          }
          break
        }
        j += 1
      }
      const stop = Math.min(j + 1, sql.length)
      // Keep the quote characters so `"t"` stays one token; blank the content.
      out += c + blank(sql.slice(i + 1, stop - 1)) + (stop - 1 > i ? sql[stop - 1] : '')
      i = stop
    } else {
      out += c
      i += 1
    }
  }
  return out
}

function lineAt(text, index) {
  let line = 1
  for (let k = 0; k < index; k++) if (text[k] === '\n') line += 1
  return line
}

/**
 * @param {string} sql one migration file
 * @returns {{ line: number, rule: string }[]}
 */
export function nonAdditiveStatements(sql) {
  const text = blankCommentsAndStrings(sql)
  const found = []
  for (const m of text.matchAll(/\bDROP\b/gi)) {
    found.push({ line: lineAt(text, m.index), rule: 'DROP removes an existing object' })
  }
  for (const m of text.matchAll(/\bRENAME\b/gi)) {
    found.push({ line: lineAt(text, m.index), rule: 'RENAME changes an existing name' })
  }
  for (const m of text.matchAll(/\bALTER\s+TABLE\s+[^;]*?\bADD\b(?:\s+COLUMN\b)?([^;]*)/gi)) {
    const definition = m[1]
    if (/\bNOT\s+NULL\b/i.test(definition) && !/\bDEFAULT\b/i.test(definition)) {
      found.push({
        line: lineAt(text, m.index),
        rule: 'ADD COLUMN NOT NULL without DEFAULT fails on a non-empty table',
      })
    }
  }
  return found.sort((a, b) => a.line - b.line)
}

function prefixOf(name) {
  const match = /^(\d+)_.*\.sql$/.exec(name)
  return match ? Number(match[1]) : null
}

export function splitByHighWater(dir, highWater) {
  const files = readdirSync(dir)
    .filter((name) => prefixOf(name) !== null)
    .sort()
  return {
    applied: files.filter((name) => prefixOf(name) <= highWater),
    pending: files.filter((name) => prefixOf(name) > highWater),
  }
}

/** @returns {{ pending: string[], violations: { file: string, line: number, rule: string }[] }} */
export function checkPendingAdditive(dir, highWater) {
  const { pending } = splitByHighWater(dir, highWater)
  const violations = []
  for (const file of pending) {
    for (const v of nonAdditiveStatements(readFileSync(path.join(dir, file), 'utf8'))) {
      violations.push({ file, ...v })
    }
  }
  return { pending, violations }
}

async function snapshot(persistDir) {
  const { DatabaseSync } = await import('node:sqlite')
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (
        entry.name.endsWith('.sqlite') &&
        entry.name !== 'metadata.sqlite' &&
        full.includes('D1DatabaseObject')
      ) {
        found.push(full)
      }
    }
  }
  walk(persistDir)
  if (found.length !== 1) {
    throw new Error(`expected one local D1 sqlite file under ${persistDir}, found ${found.length}`)
  }
  const db = new DatabaseSync(found[0], { readOnly: true })
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name)
    const out = {}
    for (const table of tables) {
      const quoted = `"${table.replaceAll('"', '""')}"`
      const columns = db
        .prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid')
        .all(table)
        .map((row) => row.name)
      const rows = Number(db.prepare(`SELECT count(*) AS n FROM ${quoted}`).get().n)
      out[table] = { columns, rows }
    }
    return out
  } finally {
    db.close()
  }
}

/** @returns {string[]} problems; empty when `after` preserves `before` */
export function compareSnapshots(before, after, { sameSchema = false } = {}) {
  const problems = []
  for (const [table, b] of Object.entries(before)) {
    const a = after[table]
    if (!a) {
      problems.push(`table ${table} is gone`)
      continue
    }
    for (const column of b.columns) {
      if (!a.columns.includes(column)) problems.push(`column ${table}.${column} is gone`)
    }
    if (!sameSchema && table !== 'd1_migrations' && a.rows !== b.rows) {
      problems.push(`table ${table} had ${b.rows} rows, now ${a.rows}`)
    }
  }
  if (sameSchema) {
    for (const [table, a] of Object.entries(after)) {
      const b = before[table]
      if (!b) problems.push(`table ${table} exists only in the second state`)
      else if (a.columns.join(',') !== b.columns.join(',')) {
        problems.push(`table ${table} columns differ: ${b.columns.join(',')} vs ${a.columns.join(',')}`)
      }
    }
  }
  return problems
}

function flag(argv, name) {
  const at = argv.indexOf(name)
  if (at === -1) return undefined
  const value = argv[at + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}

function highWaterArg(argv) {
  const raw = flag(argv, '--high-water')
  if (!raw || !/^\d{4}$/.test(raw)) throw new Error('--high-water must be a four-digit migration number')
  return Number(raw)
}

async function main(argv) {
  const [command, ...rest] = argv
  if (command === 'check') {
    const dir = path.resolve(flag(rest, '--dir') ?? '')
    const { pending, violations } = checkPendingAdditive(dir, highWaterArg(rest))
    console.log(`pending migrations: ${pending.length ? pending.join(', ') : '(none)'}`)
    if (violations.length) {
      console.error('not additive:')
      for (const v of violations) console.error(`  ${v.file}:${v.line}: ${v.rule}`)
      return 1
    }
    console.log('pending migrations are additive (no DROP, no RENAME, no NOT NULL column without DEFAULT)')
    return 0
  }
  if (command === 'pending') {
    const dir = path.resolve(flag(rest, '--dir') ?? '')
    const { applied } = splitByHighWater(dir, highWaterArg(rest))
    if (applied.length) process.stdout.write(applied.join('\n') + '\n')
    return 0
  }
  if (command === 'snapshot') {
    const data = await snapshot(path.resolve(flag(rest, '--persist') ?? ''))
    writeFileSync(flag(rest, '--out'), JSON.stringify(data, null, 2) + '\n')
    return 0
  }
  if (command === 'compare') {
    const before = JSON.parse(readFileSync(flag(rest, '--before'), 'utf8'))
    const after = JSON.parse(readFileSync(flag(rest, '--after'), 'utf8'))
    const problems = compareSnapshots(before, after, { sameSchema: rest.includes('--same-schema') })
    for (const p of problems) console.error(`  ${p}`)
    return problems.length ? 1 : 0
  }
  console.error('usage: check-migrations-additive.mjs check|pending|snapshot|compare ...')
  return 2
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`check-migrations-additive: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    },
  )
}
