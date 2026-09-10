// 0070 drops leftover production-dump objects so a schema-only rebuild matches
// a dump restore. If this test is wrong, a CREATE can slip into a drop-only
// migration, or DROP names can drift from the objects that actually exist.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import migrationText from '../migrations/0070_drop_orphan_diagnostics_and_destination_tables.sql?raw';

const db = () => (env as unknown as { DB: D1Database }).DB;

const ORPHAN_TABLES = [
  'diagnostics_failure_index',
  'diagnostics_log_failures',
  'destination_stats',
  'destination_flow_stats',
] as const;

const ORPHAN_INDEXES = [
  'diagnostics_failure_index_recent',
  'diagnostics_failure_index_class_recent',
  'diagnostics_failure_index_server_recent',
  'diagnostics_log_failures_recent',
  'diagnostics_log_failures_class_recent',
  'diagnostics_log_failures_object',
  'destination_stats_recent',
  'destination_flow_stats_recent',
] as const;

const ORPHAN_NAMES = [...ORPHAN_TABLES, ...ORPHAN_INDEXES];

const DROP_RE = /^DROP (TRIGGER|INDEX|TABLE) IF EXISTS [a-z_]+$/i;

function parseDropStatements(text: string): string[] {
  const stripped = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  return stripped
    .split(';')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0);
}

function namesOfKind(statements: string[], kind: 'TABLE' | 'INDEX' | 'TRIGGER'): string[] {
  const prefix = `DROP ${kind} IF EXISTS `;
  return statements
    .filter((stmt) => stmt.toUpperCase().startsWith(prefix))
    .map((stmt) => stmt.slice(prefix.length));
}

async function sqliteNames(names: readonly string[]): Promise<string[]> {
  const placeholders = names.map(() => '?').join(', ');
  const result = await db()
    .prepare(`SELECT name FROM sqlite_master WHERE name IN (${placeholders})`)
    .bind(...names)
    .all<{ name: string }>();
  return (result.results ?? []).map((row) => row.name).sort();
}

async function runStatements(statements: string[]): Promise<void> {
  for (const stmt of statements) {
    await db().prepare(stmt).run();
  }
}

describe('0070 orphan diagnostics/destination drop', () => {
  it('contains only DROP … IF EXISTS statements for the recovered objects', () => {
    const statements = parseDropStatements(migrationText);
    expect(statements.length).toBeGreaterThan(0);
    for (const stmt of statements) {
      expect(stmt).toMatch(DROP_RE);
    }
    expect(namesOfKind(statements, 'TABLE').sort()).toEqual([...ORPHAN_TABLES].sort());
    expect(namesOfKind(statements, 'INDEX').sort()).toEqual([...ORPHAN_INDEXES].sort());
    // The dump had no triggers on these tables; a DROP TRIGGER here would hit a live one.
    expect(namesOfKind(statements, 'TRIGGER')).toEqual([]);
  });

  it('is applied by setup and leaves no orphan names in sqlite_master', async () => {
    expect(env.TEST_MIGRATIONS.some((migration) => migration.name.startsWith('0070_'))).toBe(true);
    const applied = await db()
      .prepare("SELECT name FROM d1_migrations WHERE name LIKE '0070_%'")
      .first<{ name: string }>();
    expect(applied?.name.startsWith('0070_')).toBe(true);
    expect(await sqliteNames(ORPHAN_NAMES)).toEqual([]);
  });

  it('drops the recovered objects and is idempotent on a second apply', async () => {
    await db().batch([
      db().prepare(`CREATE TABLE diagnostics_failure_index (
        id TEXT PRIMARY KEY,
        received_at INTEGER NOT NULL,
        error_class TEXT NOT NULL,
        selected_server TEXT NOT NULL
      )`),
      db().prepare(`CREATE TABLE diagnostics_log_failures (
        id TEXT PRIMARY KEY,
        log_object_id TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        error_class TEXT NOT NULL
      )`),
      db().prepare(`CREATE TABLE destination_stats (
        day INTEGER NOT NULL,
        host TEXT NOT NULL,
        app TEXT NOT NULL,
        route TEXT NOT NULL,
        connections INTEGER NOT NULL,
        PRIMARY KEY (day, host, app, route)
      )`),
      db().prepare(`CREATE TABLE destination_flow_stats (
        day INTEGER NOT NULL,
        host TEXT NOT NULL,
        app TEXT NOT NULL,
        route TEXT NOT NULL,
        protocol TEXT NOT NULL,
        port INTEGER NOT NULL,
        connections INTEGER NOT NULL,
        PRIMARY KEY (day, host, app, route, protocol, port)
      )`),
      db().prepare(
        'CREATE INDEX diagnostics_failure_index_recent ON diagnostics_failure_index(received_at DESC)',
      ),
      db().prepare(
        'CREATE INDEX diagnostics_failure_index_class_recent ON diagnostics_failure_index(error_class, received_at DESC)',
      ),
      db().prepare(
        'CREATE INDEX diagnostics_failure_index_server_recent ON diagnostics_failure_index(selected_server, received_at DESC)',
      ),
      db().prepare(
        'CREATE INDEX diagnostics_log_failures_recent ON diagnostics_log_failures(received_at DESC)',
      ),
      db().prepare(
        'CREATE INDEX diagnostics_log_failures_class_recent ON diagnostics_log_failures(error_class, received_at DESC)',
      ),
      db().prepare(
        'CREATE INDEX diagnostics_log_failures_object ON diagnostics_log_failures(log_object_id)',
      ),
      db().prepare(
        'CREATE INDEX destination_stats_recent ON destination_stats(day DESC, connections DESC)',
      ),
      db().prepare(
        'CREATE INDEX destination_flow_stats_recent ON destination_flow_stats(day DESC, connections DESC)',
      ),
    ]);

    expect(await sqliteNames(ORPHAN_NAMES)).toEqual([...ORPHAN_NAMES].sort());

    const statements = parseDropStatements(migrationText);
    await runStatements(statements);
    expect(await sqliteNames(ORPHAN_NAMES)).toEqual([]);

    await runStatements(statements);
    expect(await sqliteNames(ORPHAN_NAMES)).toEqual([]);
  });
});
