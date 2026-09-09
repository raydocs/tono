import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  closeProviderAccount,
  createProviderAccount,
  getProviderAccount,
  listProviderAccounts,
  maskEmail,
  patchNodeProfile,
  updateProviderAccount,
} from '../src/ops/assets';

const db = () => (env as unknown as { DB: D1Database }).DB;

beforeEach(async () => {
  await db().prepare('DELETE FROM provider_accounts').run();
});

describe('maskEmail', () => {
  it('keeps two local characters and the domain', () => {
    expect(maskEmail('tester@example.com')).toBe('te***@example.com');
    expect(maskEmail('a@x.io')).toBe('a***@x.io');
    expect(maskEmail('not-an-email')).toBe('***');
  });
});

describe('provider accounts', () => {
  it('creates, lists, updates, masks login, and closes', async () => {
    const created = await createProviderAccount(db(), {
      provider: 'dmit',
      label: 'Main',
      cloudKind: 'vps',
      loginEmail: 'ops@example.com',
      billingUrl: 'https://billing.example.com/account',
      balanceHint: '~$40',
      renewNotes: 'card on file',
      secretRef: 'op://tono/dmit',
    });
    expect(created.provider).toBe('dmit');
    expect(created.label).toBe('Main');
    expect(created.cloudKind).toBe('vps');
    expect(created.loginEmailMasked).toBe('op***@example.com');
    expect(created.loginEmailMasked).not.toContain('ops@');
    expect(created.billingUrl).toBe('https://billing.example.com/account');
    expect(created.status).toBe('active');

    const listed = await listProviderAccounts(db());
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);

    const updated = await updateProviderAccount(db(), created.id, {
      label: 'Main card',
      status: 'active',
      loginEmail: 'billing@example.com',
    });
    expect(updated.label).toBe('Main card');
    expect(updated.loginEmailMasked).toBe('bi***@example.com');

    const closed = await closeProviderAccount(db(), created.id);
    expect(closed.status).toBe('closed');
    expect((await getProviderAccount(db(), created.id)).status).toBe('closed');
  });

  it('rejects invalid fields with ApiError', async () => {
    await expect(createProviderAccount(db(), {
      provider: '',
      label: 'x',
    })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });

    await expect(createProviderAccount(db(), {
      provider: 'dmit',
      label: 'x',
      billingUrl: 'javascript:alert(1)',
    })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });

    await expect(createProviderAccount(db(), {
      provider: 'dmit',
      label: 'x',
      cloudKind: 'aws',
    })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });

    await expect(createProviderAccount(db(), {
      provider: 'dmit',
      label: 'x',
      loginEmail: 'not-an-email',
    })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });

    await expect(getProviderAccount(db(), 'missing')).rejects.toBeInstanceOf(ApiError);
    await expect(getProviderAccount(db(), 'missing')).rejects.toMatchObject({ status: 404 });
  });
});

describe('node profile asset patch', () => {
  it('writes the new columns and rejects a missing provider account', async () => {
    await db().prepare(
      `INSERT INTO ops_node_profiles(id, catalog_name, status, created_at, updated_at)
       VALUES('np1', 'Tokyo · North', 'active', 1, 1)`,
    ).run();

    const account = await createProviderAccount(db(), { provider: 'dmit', label: 'Main' });
    const patched = await patchNodeProfile(db(), 'np1', {
      providerAccountId: account.id,
      expiresAt: 1_900_000_000,
      os: 'ubuntu-24.04',
      region: 'tyo',
      lineTags: ['cmi', 'gia'],
      quotaCounts: 'out',
      cycleKind: 'rolling_30d',
      cycleAnchorDay: 15,
      autoUnlistAtPct: 95,
    });
    expect(patched.providerAccountId).toBe(account.id);
    expect(patched.expiresAt).toBe(1_900_000_000);
    expect(patched.os).toBe('ubuntu-24.04');
    expect(patched.region).toBe('tyo');
    expect(patched.lineTags).toEqual(['cmi', 'gia']);
    expect(patched.quotaCounts).toBe('out');
    expect(patched.cycleKind).toBe('rolling_30d');
    expect(patched.cycleAnchorDay).toBe(15);
    expect(patched.autoUnlistAtPct).toBe(95);

    await expect(patchNodeProfile(db(), 'np1', {
      providerAccountId: 'no-such-account',
    })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });

    await expect(patchNodeProfile(db(), 'np1', {
      quotaCounts: 'both',
    })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });

    await expect(patchNodeProfile(db(), 'missing', { os: 'debian' }))
      .rejects.toMatchObject({ status: 404 });
  });
});
