#!/usr/bin/env node
// Drop D1 objects in FK-safe order: triggers, views, indexes, then tables
// children-first. D1 will not disable foreign keys, will not drop _cf_KV, and
// rolls back a multi-statement file that hits SQLITE_CONSTRAINT_TRIGGER, so
// the only tested path is small --command batches in dependency order.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const CONTROL_PLANE = path.resolve(REPO_ROOT, 'services', 'control-plane');

export const REFUSED_DATABASES = Object.freeze(['tono-control-plane', 'DB']);
const ALLOWED_REMAINDERS = new Set(['_cf_KV', 'sqlite_sequence']);

const SQLITE_MASTER_SELECT =
  "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'";
const SQLITE_MASTER_REMAINING = 'SELECT type, name FROM sqlite_master';

const HELP = `\
wipe-d1-in-order: drop D1 objects in FK-safe order (triggers, views, indexes, tables).

Usage:
  node tooling/scripts/wipe-d1-in-order.mjs [--plan] (--from-json FILE | --from-database NAME) [options]
  node tooling/scripts/wipe-d1-in-order.mjs --apply --database NAME [options]

Input: sqlite_master rows (type, name, tbl_name, sql). --from-json accepts wrangler
  d1 execute --json output or a bare row array. --from-database NAME runs
  npx wrangler d1 execute NAME --remote --json from services/control-plane.

Always skips sqlite_* and _cf_* (never drop _cf_KV). d1_migrations is dropped
  unless --keep d1_migrations; restore must not keep it (the dump re-imports it).

--plan (default) prints DROP statements in --batch N chunks (default 10),
  blank line between batches. --apply runs each batch via wrangler, stops on
  the first failure, then asserts only _cf_KV / sqlite_sequence remain.

--apply against tono-control-plane or DB is refused unless both
  --i-mean-production and TONO_ALLOW_PRODUCTION_WIPE=1 are set; even then the
  database name and table count print before the first batch.

Options: --batch N  --keep NAME  --i-mean-production
Exit: 0 ok; 1 usage/refusal; 2 FK cycle; 3 leftovers after apply; 4 batch failed.`;

export class CycleError extends Error {
  constructor(tables) {
    const list = [...tables].sort();
    super(`cycle in foreign-key graph: ${list.join(', ')}`);
    this.name = 'CycleError';
    this.tables = list;
  }
}

export function isInternalName(name) {
  const n = String(name ?? '');
  return /^sqlite_/i.test(n) || /^_cf_/i.test(n);
}

export function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

export function chunk(items, n) {
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError(`batch size must be a positive integer, got ${n}`);
  }
  const out = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(items.slice(i, i + n));
  }
  return out;
}

export function stripSqlComments(sql) {
  if (sql == null) return '';
  const s = String(sql);
  let out = '';
  let i = 0;
  const len = s.length;
  while (i < len) {
    const c = s[i];
    const n = s[i + 1];
    if (c === '-' && n === '-') {
      i += 2;
      while (i < len && s[i] !== '\n') i++;
      out += ' ';
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < len && !(s[i] === '*' && s[i + 1] === '/')) i++;
      if (i < len) i += 2;
      out += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += c;
      i++;
      while (i < len) {
        out += s[i];
        if (q !== '`' && s[i] === q && s[i + 1] === q) {
          out += s[i + 1];
          i += 2;
          continue;
        }
        if (s[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function readIdent(s, start) {
  let i = start;
  const len = s.length;
  while (i < len && /\s/.test(s[i])) i++;
  if (i >= len) return null;
  if (s[i] === '"') {
    i++;
    let name = '';
    while (i < len) {
      if (s[i] === '"' && s[i + 1] === '"') {
        name += '"';
        i += 2;
        continue;
      }
      if (s[i] === '"') {
        i++;
        break;
      }
      name += s[i];
      i++;
    }
    return { name, end: i };
  }
  if (s[i] === '`') {
    i++;
    let name = '';
    while (i < len && s[i] !== '`') {
      name += s[i];
      i++;
    }
    if (i < len) i++;
    return { name, end: i };
  }
  if (s[i] === '[') {
    i++;
    let name = '';
    while (i < len && s[i] !== ']') {
      name += s[i];
      i++;
    }
    if (i < len) i++;
    return { name, end: i };
  }
  const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
  if (!m) return null;
  return { name: m[0], end: i + m[0].length };
}

export function parseReferences(tableName, sql) {
  const parents = new Set();
  if (sql == null || sql === '') return parents;
  const stripped = stripSqlComments(String(sql));
  const re = /\bREFERENCES\s+/gi;
  let match;
  const self = String(tableName).toLowerCase();
  while ((match = re.exec(stripped))) {
    const ident = readIdent(stripped, re.lastIndex);
    if (!ident || ident.name === '') continue;
    re.lastIndex = ident.end;
    if (ident.name.toLowerCase() === self) continue;
    parents.add(ident.name);
  }
  return parents;
}

function dropStatement(kind, name) {
  return `DROP ${kind} IF EXISTS ${quoteIdent(name)};`;
}

function sortedByName(names) {
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function topologicalTables(tables) {
  const tableByLower = new Map();
  for (const table of tables) {
    tableByLower.set(table.name.toLowerCase(), table.name);
  }
  const nodes = tables.map((t) => t.name);
  const nodeSet = new Set(nodes);
  const outgoing = new Map(nodes.map((n) => [n, []]));
  const indegree = new Map(nodes.map((n) => [n, 0]));

  for (const table of tables) {
    for (const rawParent of parseReferences(table.name, table.sql)) {
      const parent = tableByLower.get(rawParent.toLowerCase());
      if (!parent || parent === table.name || !nodeSet.has(parent)) continue;
      outgoing.get(table.name).push(parent);
      indegree.set(parent, indegree.get(parent) + 1);
    }
  }

  const ready = sortedByName(nodes.filter((n) => indegree.get(n) === 0));
  const order = [];
  while (ready.length > 0) {
    const n = ready.shift();
    order.push(n);
    for (const parent of outgoing.get(n)) {
      const next = indegree.get(parent) - 1;
      indegree.set(parent, next);
      if (next === 0) {
        ready.push(parent);
        ready.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      }
    }
  }

  if (order.length !== nodes.length) {
    const leftover = nodes.filter((n) => !order.includes(n));
    throw new CycleError(leftover);
  }
  return order;
}

export function planDrops(rows, options = {}) {
  const keep = new Set((options.keep ?? []).map((n) => String(n)));
  const triggers = [];
  const views = [];
  const indexes = [];
  const tables = [];

  for (const row of rows ?? []) {
    const name = row?.name;
    if (name == null || name === '') continue;
    if (isInternalName(name) || keep.has(name)) continue;
    const type = String(row.type ?? '').toLowerCase();
    if (type === 'trigger') {
      triggers.push(name);
    } else if (type === 'view') {
      views.push(name);
    } else if (type === 'index') {
      if (row.sql == null) continue;
      indexes.push(name);
    } else if (type === 'table') {
      tables.push({ name, sql: row.sql });
    }
  }

  const statements = [];
  for (const name of sortedByName(new Set(triggers))) {
    statements.push(dropStatement('TRIGGER', name));
  }
  for (const name of sortedByName(new Set(views))) {
    statements.push(dropStatement('VIEW', name));
  }
  for (const name of sortedByName(new Set(indexes))) {
    statements.push(dropStatement('INDEX', name));
  }
  const tableOrder = topologicalTables(tables);
  for (const name of tableOrder) {
    statements.push(dropStatement('TABLE', name));
  }

  return {
    statements,
    tables: tableOrder,
    counts: {
      triggers: new Set(triggers).size,
      views: new Set(views).size,
      indexes: new Set(indexes).size,
      tables: tableOrder.length,
    },
  };
}

export function flattenSqliteMasterJson(parsed) {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return [];
    if (parsed.some((el) => el && Array.isArray(el.results))) {
      return parsed.flatMap((el) => (Array.isArray(el?.results) ? el.results : []));
    }
    return parsed;
  }
  if (parsed && Array.isArray(parsed.results)) return parsed.results;
  throw new Error('unrecognized sqlite_master JSON shape (expected wrangler --json array or a row array)');
}

function loadRowsFromJson(file) {
  const text = readFileSync(file, 'utf8');
  return flattenSqliteMasterJson(JSON.parse(text));
}

function productionAllowed(opts) {
  return Boolean(opts.iMeanProduction) && process.env.TONO_ALLOW_PRODUCTION_WIPE === '1';
}

function isRefusedName(name) {
  return REFUSED_DATABASES.includes(name);
}

function refuseProductionArgv(args, allowProduction) {
  for (const arg of args) {
    if (isRefusedName(arg) && !allowProduction) {
      const err = new Error(
        `refusing to run against production database ${arg}; need --i-mean-production and TONO_ALLOW_PRODUCTION_WIPE=1`,
      );
      err.exitCode = 1;
      throw err;
    }
  }
}

function wranglerJson(database, command, allowProduction) {
  const args = [
    'wrangler',
    'd1',
    'execute',
    database,
    '--remote',
    '--json',
    '-y',
    '--command',
    command,
  ];
  refuseProductionArgv(args, allowProduction);
  const stdout = execFileSync('npx', args, {
    cwd: CONTROL_PLANE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return flattenSqliteMasterJson(JSON.parse(stdout));
}

function applyBatches(database, batches, allowProduction) {
  for (const batch of batches) {
    const command = batch.join(' ');
    const args = ['wrangler', 'd1', 'execute', database, '--remote', '-y', '--command', command];
    refuseProductionArgv(args, allowProduction);
    try {
      execFileSync('npx', args, {
        cwd: CONTROL_PLANE,
        encoding: 'utf8',
        stdio: ['ignore', 'inherit', 'inherit'],
      });
    } catch {
      console.error('wipe-d1-in-order: batch failed:');
      console.error(command);
      return 4;
    }
  }
  return 0;
}

function printSummary(target, counts) {
  console.error(
    `wipe-d1-in-order: ${target}: triggers=${counts.triggers} views=${counts.views} indexes=${counts.indexes} tables=${counts.tables}`,
  );
}

function takeValue(argv, i, flag) {
  const cur = argv[i];
  if (cur.startsWith(`${flag}=`)) return { value: cur.slice(flag.length + 1), next: i + 1 };
  if (i + 1 >= argv.length) {
    const err = new Error(`${flag} requires a value`);
    err.exitCode = 1;
    throw err;
  }
  return { value: argv[i + 1], next: i + 2 };
}

function parsePositiveInt(raw, flag) {
  if (!/^[1-9]\d*$/.test(raw)) {
    const err = new Error(`${flag} must be a positive integer, got ${raw}`);
    err.exitCode = 1;
    throw err;
  }
  return Number(raw);
}

function parseArgs(argv) {
  const opts = {
    help: false,
    apply: false,
    database: null,
    fromJson: null,
    fromDatabase: null,
    batch: 10,
    keep: [],
    iMeanProduction: false,
  };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      opts.help = true;
      i++;
    } else if (a === '--plan') {
      opts.apply = false;
      i++;
    } else if (a === '--apply') {
      opts.apply = true;
      i++;
    } else if (a === '--i-mean-production') {
      opts.iMeanProduction = true;
      i++;
    } else if (a === '--database' || a.startsWith('--database=')) {
      const got = takeValue(argv, i, '--database');
      opts.database = got.value;
      i = got.next;
    } else if (a === '--from-json' || a.startsWith('--from-json=')) {
      const got = takeValue(argv, i, '--from-json');
      opts.fromJson = got.value;
      i = got.next;
    } else if (a === '--from-database' || a.startsWith('--from-database=')) {
      const got = takeValue(argv, i, '--from-database');
      opts.fromDatabase = got.value;
      i = got.next;
    } else if (a === '--batch' || a.startsWith('--batch=')) {
      const got = takeValue(argv, i, '--batch');
      opts.batch = parsePositiveInt(got.value, '--batch');
      i = got.next;
    } else if (a === '--keep' || a.startsWith('--keep=')) {
      const got = takeValue(argv, i, '--keep');
      opts.keep.push(got.value);
      i = got.next;
    } else {
      const err = new Error(`unknown argument: ${a}`);
      err.exitCode = 1;
      throw err;
    }
  }
  return opts;
}

export function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    console.error(`wipe-d1-in-order: ${error.message}`);
    return error.exitCode ?? 1;
  }

  if (opts.help) {
    console.log(HELP);
    return 0;
  }

  if (opts.apply && opts.fromJson) {
    console.error('wipe-d1-in-order: --apply cannot be combined with --from-json');
    return 1;
  }
  if (opts.apply && !opts.database) {
    console.error('wipe-d1-in-order: --apply requires --database');
    return 1;
  }
  if (opts.fromJson && opts.fromDatabase) {
    console.error('wipe-d1-in-order: use only one of --from-json and --from-database');
    return 1;
  }
  if (opts.apply && opts.fromDatabase && opts.fromDatabase !== opts.database) {
    console.error('wipe-d1-in-order: --from-database must equal --database when applying');
    return 1;
  }
  if (!opts.apply && !opts.fromJson && !opts.fromDatabase) {
    console.error('wipe-d1-in-order: --plan requires --from-json or --from-database');
    return 1;
  }

  const allowProduction = productionAllowed(opts);
  const targetName = opts.apply ? opts.database : (opts.fromDatabase ?? opts.fromJson);
  if (opts.apply && isRefusedName(opts.database) && !allowProduction) {
    console.error(
      `wipe-d1-in-order: refusing to apply against production database ${opts.database}; need --i-mean-production and TONO_ALLOW_PRODUCTION_WIPE=1`,
    );
    return 1;
  }

  let rows;
  try {
    if (opts.fromJson) {
      rows = loadRowsFromJson(opts.fromJson);
    } else {
      const fetchName = opts.fromDatabase ?? opts.database;
      rows = wranglerJson(fetchName, SQLITE_MASTER_SELECT, allowProduction);
    }
  } catch (error) {
    if (error.exitCode === 1) {
      console.error(`wipe-d1-in-order: ${error.message}`);
      return 1;
    }
    console.error(`wipe-d1-in-order: failed to load sqlite_master: ${error.message}`);
    return 1;
  }

  let plan;
  try {
    plan = planDrops(rows, { keep: opts.keep });
  } catch (error) {
    if (error instanceof CycleError) {
      console.error(`wipe-d1-in-order: ${error.message}`);
      return 2;
    }
    throw error;
  }

  const productionApply = opts.apply && isRefusedName(opts.database) && allowProduction;
  printSummary(targetName, plan.counts);
  if (productionApply) {
    console.error(
      `wipe-d1-in-order: about to drop ${plan.counts.tables} tables from ${opts.database}`,
    );
  }

  const batches = chunk(plan.statements, opts.batch);
  if (!opts.apply) {
    for (let i = 0; i < batches.length; i++) {
      if (i > 0) console.log('');
      for (const stmt of batches[i]) console.log(stmt);
    }
    return 0;
  }

  const applyStatus = applyBatches(opts.database, batches, allowProduction);
  if (applyStatus !== 0) return applyStatus;

  let remaining;
  try {
    remaining = wranglerJson(opts.database, SQLITE_MASTER_REMAINING, allowProduction);
  } catch (error) {
    if (error.exitCode === 1) {
      console.error(`wipe-d1-in-order: ${error.message}`);
      return 1;
    }
    console.error(`wipe-d1-in-order: failed to re-read sqlite_master: ${error.message}`);
    return 1;
  }

  const keep = new Set(opts.keep);
  const leftovers = [];
  for (const row of remaining) {
    const name = row?.name;
    if (name == null || name === '') continue;
    if (ALLOWED_REMAINDERS.has(name) || isInternalName(name) || keep.has(name)) continue;
    leftovers.push(name);
  }
  if (leftovers.length > 0) {
    console.error(`wipe-d1-in-order: leftover objects after apply: ${sortedByName(leftovers).join(', ')}`);
    return 3;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
