import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_ADMIN_WORKER_NAME,
  PREVIEW_API_WORKER_NAME,
  previewDeploymentPlan,
  renderPreviewConfigs,
} from '../preview/config.mjs';
import { partialSourceFailureSql, previewSeedSql } from '../preview/seed.mjs';

const input = {
  d1DatabaseId: '11111111-2222-4333-8444-555555555555',
  adminHostname: 'ops-preview.example.test',
  diagnosticsBucket: 'tono-ops-preview-diagnostics',
  releasesBucket: 'tono-ops-preview-releases',
};

// D1's test-pool `exec()` does not accept a script containing multiple
// statements. The remote `wrangler d1 execute --file` command does, while this
// runner validates every emitted statement through the same D1 binding.
function splitSqlStatements(script) {
  const statements = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < script.length; index += 1) {
    if (script[index] === "'") {
      if (quoted && script[index + 1] === "'") {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && script[index] === ';') {
      const statement = script.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = script.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

async function runSqlScript(db, script) {
  for (const statement of splitSqlStatements(script)) {
    await db.prepare(statement).run();
  }
}

describe('isolated operations preview', () => {
  it('renders separate private API and Access-hosted admin configurations', () => {
    const { api, admin } = renderPreviewConfigs(input);
    expect(api.name).toBe(PREVIEW_API_WORKER_NAME);
    expect(admin.name).toBe(PREVIEW_ADMIN_WORKER_NAME);
    expect(api.workers_dev).toBe(false);
    expect(api.routes).toBeUndefined();
    expect(admin.workers_dev).toBe(false);
    expect(admin.routes).toEqual([{ pattern: 'ops-preview.example.test', custom_domain: true }]);
    expect(admin.services).toEqual([{ binding: 'API', service: PREVIEW_API_WORKER_NAME }]);
    expect(api.d1_databases[0]).toMatchObject({
      database_name: 'tono-control-plane-ops-preview',
      database_id: input.d1DatabaseId,
    });
    expect(admin.d1_databases[0].database_id).toBe(input.d1DatabaseId);
    expect(api.r2_buckets.map((bucket) => bucket.bucket_name)).toEqual([
      input.diagnosticsBucket,
      input.releasesBucket,
    ]);
    expect(api.vars.ALLOWED_ORIGIN).toBe('https://ops-preview.example.test');
    expect(admin.vars.ALLOWED_ORIGIN).toBe('https://ops-preview.example.test');
    expect(JSON.stringify({ api, admin })).not.toContain('afk.ccwu.cc');
    expect(JSON.stringify({ api, admin })).not.toContain('tono-control-plane-staging');
    expect(api.vars.TAILSCALE_ENROLLMENT_ENABLED).toBe('false');
    expect(api.secrets.required).not.toContain('RESEND_API_KEY');
    expect(api.secrets.required).not.toContain('TAILSCALE_OAUTH_CLIENT_SECRET');
  });

  it('refuses production-shaped hostnames, bucket names, and invalid build identifiers', () => {
    expect(() => renderPreviewConfigs({ ...input, adminHostname: 'admin.afk.ccwu.cc' })).toThrow(/non-production hostname/);
    expect(() => renderPreviewConfigs({ ...input, adminHostname: 'ops-preview.afk.ccwu.cc' })).toThrow(/non-production hostname/);
    expect(() => renderPreviewConfigs({ ...input, adminHostname: 'ops-preview-11e0d95f.afk.ccwu.cc' })).not.toThrow();
    expect(() => renderPreviewConfigs({ ...input, diagnosticsBucket: 'tono-diagnostics-logs' })).toThrow(/tono-ops-preview-/);
    expect(() => renderPreviewConfigs({ ...input, d1DatabaseId: '00000000-0000-0000-0000-000000000000' })).toThrow(/non-placeholder D1 UUID/);
    expect(() => previewDeploymentPlan('development')).toThrow(/40-character Git SHA/);
  });

  it('uses one valid SHA for both deployment targets', () => {
    const buildSha = 'a'.repeat(40);
    const plan = previewDeploymentPlan(buildSha);
    expect(plan.api.buildSha).toBe(buildSha);
    expect(plan.admin.buildSha).toBe(buildSha);
    expect(plan.api.buildSha).toBe(plan.admin.buildSha);
  });

  it('applies only synthetic seed data and preserves the writer-v2 markers', async () => {
    const emails = [...new Set(previewSeedSql.match(/[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+/g) ?? [])];
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.every((email) => email.endsWith('@example.test'))).toBe(true);
    const ipv4 = previewSeedSql.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
    expect(ipv4.length).toBeGreaterThan(0);
    expect(ipv4.every((address) => (
      address.startsWith('192.0.2.') ||
      address.startsWith('198.51.100.') ||
      address.startsWith('203.0.113.')
    ))).toBe(true);

    const db = env.DB;
    await runSqlScript(db, previewSeedSql);
    const users = await db.prepare(
      "SELECT email FROM users WHERE id LIKE 'usr-preview-%' ORDER BY email",
    ).all();
    expect(users.results.map((row) => row.email)).toEqual([
      'alpha@example.test',
      'beta@example.test',
      'gamma@example.test',
    ]);
    const rollups = await db.prepare(
      "SELECT DISTINCT rollup_writer_version, sample_counts_exact FROM operations_agent_rollups WHERE node_name LIKE 'Preview %'",
    ).all();
    expect(rollups.results).not.toHaveLength(0);
    expect(rollups.results.every((row) => row.rollup_writer_version === 2 && row.sample_counts_exact === 1)).toBe(true);

    await db.prepare(partialSourceFailureSql).run();
    const partial = await db.prepare(
      'SELECT quality_json, agents_json FROM operations_live_snapshot WHERE singleton_id = 1',
    ).first();
    expect(partial.quality_json).not.toBeNull();
    expect(partial.agents_json).toBeNull();
    await runSqlScript(db, previewSeedSql);
    const restored = await db.prepare(
      'SELECT agents_json FROM operations_live_snapshot WHERE singleton_id = 1',
    ).first();
    expect(restored.agents_json).not.toBeNull();
  });
});
