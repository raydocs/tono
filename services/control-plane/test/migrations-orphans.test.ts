// 0070 drops leftover production-dump objects so a schema-only rebuild matches
// a dump restore. One check: the file is drop-only, and after setup applied it
// none of the orphan names exist.
import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import migrationText from '../migrations/0070_drop_orphan_diagnostics_and_destination_tables.sql?raw';

const ORPHANS = [
  'diagnostics_failure_index', 'diagnostics_log_failures', 'destination_stats', 'destination_flow_stats',
  'diagnostics_failure_index_recent', 'diagnostics_failure_index_class_recent',
  'diagnostics_failure_index_server_recent', 'diagnostics_log_failures_recent',
  'diagnostics_log_failures_class_recent', 'diagnostics_log_failures_object',
  'destination_stats_recent', 'destination_flow_stats_recent',
];

it('0070 is drop-only and leaves no orphan diagnostics/destination object behind', async () => {
  const statements = migrationText.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    .split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  expect(statements.length).toBe(ORPHANS.length);
  for (const s of statements) expect(s).toMatch(/^DROP (INDEX|TABLE) IF EXISTS [a-z_]+$/);
  const db = (env as unknown as { DB: D1Database }).DB;
  const rows = await db.prepare(`SELECT name FROM sqlite_master WHERE name IN (${ORPHANS.map(() => '?').join(',')})`)
    .bind(...ORPHANS).all<{ name: string }>();
  expect(rows.results.map((r) => r.name)).toEqual([]);
});
