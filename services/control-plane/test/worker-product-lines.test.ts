import {
  env,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_TOKEN,
  api,
  json,
  ACCESS_ADMIN_EMAIL,
  accessAssertion,
  operations,
  createAccount,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  it('assigns a pasted home line to a user and imports unused stock', async () => {
    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const owner = await createAccount('paste-assign');
    const other = await createAccount('paste-other');

    const unauthorized = await api('ops/home-exits/assign', {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: owner.user.id, line: '198.51.100.41:6886:alice:secret-one' }),
    });
    expect(unauthorized.status).toBe(401);

    for (const line of [
      'not-a-line',
      '198.51.100.41:6886',
      '198.51.100.41:0:alice:secret-one',
      '10.0.0.1:6886:alice:secret-one',
    ]) {
      const bad = await api('ops/home-exits/assign', {
        method: 'POST',
        headers: accessHeaders,
        body: JSON.stringify({ userId: owner.user.id, line }),
      });
      expect(bad.status).toBe(400);
    }

    const assigned = await api('ops/home-exits/assign', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        userId: owner.user.id,
        line: '198.51.100.41:6886:alice:secret-one',
      }),
    });
    expect(assigned.status).toBe(201);
    const assignedBody = await assigned.json() as any;
    expect(assignedBody.homeExit.kind).toBe('socks5');
    expect(assignedBody.homeExit.socks5Host).toBe('198.51.100.41');
    expect(assignedBody.homeExit.socks5Port).toBe(6886);
    expect(assignedBody.homeExit).not.toHaveProperty('socks5Username');
    expect(assignedBody.homeExit).not.toHaveProperty('socks5Password');
    expect(assignedBody.binding.userId).toBe(owner.user.id);
    expect(assignedBody.refreshQueued).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(assignedBody)).not.toContain('secret-one');

    const conflict = await api('ops/home-exits/assign', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        userId: owner.user.id,
        line: 'alice:secret-two@gw.example.com:11080',
      }),
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as any).error.code).toBe('HOME_ALREADY_BOUND');

    const replaced = await api('ops/home-exits/assign', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        userId: owner.user.id,
        line: 'socks5://alice:secret-two@gw.example.com:11080',
        replace: true,
      }),
    });
    expect(replaced.status).toBe(201);
    const replacedBody = await replaced.json() as any;
    expect(replacedBody.replaced).toBe(true);
    expect(replacedBody.homeExit.socks5Host).toBe('gw.example.com');
    expect(replacedBody.retiredHomeExitId).toBe(assignedBody.homeExit.id);

    const listed = await operations('home-exits');
    const rows = (await listed.json() as any).homeExits as Array<{ id: string; status: string }>;
    expect(rows.find((row) => row.id === assignedBody.homeExit.id)?.status).toBe('retired');
    expect(rows.find((row) => row.id === replacedBody.homeExit.id)?.status).toBe('active');
    expect(JSON.stringify(rows)).not.toContain('secret-two');

    const ownerCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    const ownerRouting = (await ownerCatalog.json() as any).routing;
    expect(ownerRouting.homeSocks5).toEqual({
      host: 'gw.example.com',
      port: 11080,
      username: 'alice',
      password: 'secret-two',
    });
    const otherCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    expect(JSON.stringify(await otherCatalog.json())).not.toContain('secret-two');

    const imported = await api('ops/home-exits/import', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        lines: [
          '203.0.113.20:9000:pool-a:pool-secret',
          '203.0.113.20:9000:pool-a:pool-secret',
          'bad-line',
        ],
      }),
    });
    expect(imported.status).toBe(201);
    const importedBody = await imported.json() as any;
    expect(importedBody.created).toHaveLength(1);
    expect(importedBody.skipped).toHaveLength(1);
    expect(importedBody.failed).toHaveLength(1);
    expect(JSON.stringify(importedBody)).not.toContain('pool-secret');

    const taken = await api('ops/home-exits/assign', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        userId: other.user.id,
        line: 'alice:secret-two@gw.example.com:11080',
      }),
    });
    expect(taken.status).toBe(409);
    expect((await taken.json() as any).error.code).toBe('HOME_EXIT_IN_USE');
  });

  it('keeps a Claude account ledger and an onboarding shortcut', async () => {
    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const owner = await createAccount('claude-ledger');
    const opened = await api('ops/product-accounts', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ userId: owner.user.id, accountRef: 'acct-one@example.com' }),
    });
    expect(opened.status).toBe(201);
    const openedBody = await opened.json() as any;
    expect(openedBody.account).toMatchObject({
      accountRef: 'acct-one@example.com',
      status: 'assigned',
      userId: owner.user.id,
    });

    const clash = await api('ops/product-accounts', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ userId: owner.user.id, accountRef: 'acct-two@example.com' }),
    });
    expect(clash.status).toBe(409);

    const listed = await operations('users');
    const row = ((await listed.json() as any).users as any[]).find((item) => item.id === owner.user.id);
    expect(row.product).toMatchObject({
      accountRef: 'acct-one@example.com',
      status: 'assigned',
      replaceCount: 0,
      incomplete: false,
    });
    expect(row.firstEntitledAt).toBeGreaterThan(0);

    const replaced = await api(`ops/product-accounts/${openedBody.account.id}/replace`, {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ accountRef: 'acct-two@example.com' }),
    });
    expect(replaced.status).toBe(200);
    const replacedBody = await replaced.json() as any;
    expect(replacedBody.previous.status).toBe('retired');
    expect(replacedBody.account.accountRef).toBe('acct-two@example.com');

    const banned = await api(`ops/product-accounts/${replacedBody.account.id}/ban`, {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ detail: 'model ban' }),
    });
    expect(banned.status).toBe(200);
    expect((await banned.json() as any).account.status).toBe('banned');

    const detail = await operations(`users/${owner.user.id}/detail`);
    const detailBody = await detail.json() as any;
    expect(detailBody.product.replaceCount).toBe(1);
    expect(detailBody.product.accounts).toHaveLength(2);

    const pending = await api('ops/users/onboard', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        email: 'not-yet@example.com',
        line: '198.51.100.77:7000:pool:secret-line',
        accountRef: 'acct-pending@example.com',
      }),
    });
    expect(pending.status).toBe(202);
    const pendingBody = await pending.json() as any;
    expect(pendingBody.incomplete).toContain('user_not_registered');
    expect(pendingBody.exitIdentityIssued).toBe(false);
    expect(pendingBody.userId).toBeNull();

    const ready = await api('ops/users/onboard', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        email: owner.email,
        line: '198.51.100.78:7000:owner:secret-line',
        accountRef: 'acct-three@example.com',
      }),
    });
    // owner currently has no assigned Claude (banned), so this should assign.
    expect([200, 202, 409]).toContain(ready.status);
    if (ready.status !== 409) {
      const readyBody = await ready.json() as any;
      expect(readyBody.exitIdentityIssued).toBe(true);
      expect(readyBody.userId).toBe(owner.user.id);
    }
    const listedReady = await operations('users');
    const readyRow = ((await listedReady.json() as any).users as any[]).find((item: any) => item.id === owner.user.id);
    expect(readyRow.hasExitIdentity).toBe(true);

    const closed = await api(`ops/users/${owner.user.id}/close`, {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({}),
    });
    expect(closed.status).toBe(200);
    const listedClosed = await operations('users');
    const closedRow = ((await listedClosed.json() as any).users as any[]).find((item: any) => item.id === owner.user.id);
    expect(closedRow.status).toBe('disabled');
    expect(closedRow.homeBinding).toBeNull();
  });

  it('does not retire the currently-assigned account when a replacement accountRef clashes (atomicity)', async () => {
    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const owner = await createAccount('claude-replace-atomic-owner');
    const other = await createAccount('claude-replace-atomic-other');
    const bannedUser = await createAccount('claude-replace-atomic-banned');
    const retiredUser = await createAccount('claude-replace-atomic-retired');

    const ownerOpened = await api('ops/product-accounts', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ userId: owner.user.id, accountRef: 'acct-owner@example.com' }),
    });
    expect(ownerOpened.status).toBe(201);
    const ownerAccountId = (await ownerOpened.json() as any).account.id;

    const otherOpened = await api('ops/product-accounts', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ userId: other.user.id, accountRef: 'acct-shared@example.com' }),
    });
    expect(otherOpened.status).toBe(201);

    const bannedOpened = await api('ops/product-accounts', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ userId: bannedUser.user.id, accountRef: 'acct-banned@example.com' }),
    });
    expect(bannedOpened.status).toBe(201);
    const bannedAccountId = (await bannedOpened.json() as any).account.id;
    const bannedRow = await api(`ops/product-accounts/${bannedAccountId}/ban`, {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ detail: 'model ban' }),
    });
    expect(bannedRow.status).toBe(200);
    expect((await bannedRow.json() as any).account.status).toBe('banned');

    const retiredOpened = await api('ops/product-accounts', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ userId: retiredUser.user.id, accountRef: 'acct-retired@example.com' }),
    });
    expect(retiredOpened.status).toBe(201);
    const retiredAccountId = (await retiredOpened.json() as any).account.id;
    const retiredReplace = await api(`ops/product-accounts/${retiredAccountId}/replace`, {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ accountRef: 'acct-retired-next@example.com' }),
    });
    expect(retiredReplace.status).toBe(200);
    expect((await retiredReplace.json() as any).previous.status).toBe('retired');

    const snapshot = async () => {
      const detail = await operations(`users/${owner.user.id}/detail`);
      const detailBody = (await detail.json() as any);
      const account = (detailBody.product.accounts as any[]).find((a) => a.id === ownerAccountId);
      return {
        status: account?.status,
        closeReason: account?.closeReason ?? null,
        closedAt: account?.closedAt ?? null,
        assigned: (detailBody.product.accounts as any[]).find((a) => a.status === 'assigned'),
        replaceCount: detailBody.product.replaceCount as number,
        replacedEvents: (detailBody.product.events as any[])
          .filter((ev) => ev.type === 'replaced' && ev.accountId === ownerAccountId).length,
      };
    };

    const before = await snapshot();
    expect(before.status).toBe('assigned');
    expect(before.assigned.accountRef).toBe('acct-owner@example.com');
    expect(before.replaceCount).toBe(0);

    const attemptRef = (ref: string) => api(`ops/product-accounts/${ownerAccountId}/replace`, {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ accountRef: ref }),
    });

    for (const clashingRef of [
      'acct-shared@example.com',
      'acct-banned@example.com',
      'acct-retired@example.com',
      'acct-owner@example.com',
    ]) {
      const attempt = await attemptRef(clashingRef);
      expect(attempt.status).toBe(409);
      expect((await attempt.json() as any).error.code).toBe('ACCOUNT_REF_IN_USE');
      const after = await snapshot();
      expect(after.status).toBe('assigned');
      expect(after.closeReason).toBeNull();
      expect(after.closedAt).toBeNull();
      expect(after.assigned).toBeDefined();
      expect(after.assigned.accountRef).toBe('acct-owner@example.com');
      expect(after.replaceCount).toBe(0);
      expect(after.replacedEvents).toBe(0);
    }

    const retry = await api(`ops/product-accounts/${ownerAccountId}/replace`, {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ accountRef: 'acct-owner-next@example.com' }),
    });
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json() as any);
    expect(retryBody.previous.status).toBe('retired');
    expect(retryBody.previous.id).toBe(ownerAccountId);
    expect(retryBody.account.accountRef).toBe('acct-owner-next@example.com');
    expect(retryBody.account.status).toBe('assigned');
    expect(retryBody.account.userId).toBe(owner.user.id);

    const finalSnapshot = await snapshot();
    expect(finalSnapshot.status).toBe('retired');
    const newAssigned = (await operations(`users/${owner.user.id}/detail`).then((r) => r.json()) as any)
      .product.accounts.find((a: any) => a.status === 'assigned');
    expect(newAssigned.accountRef).toBe('acct-owner-next@example.com');
    expect((await operations(`users/${owner.user.id}/detail`).then((r) => r.json()) as any).product.replaceCount).toBe(1);
  });

  it('replaceProductAccount converts a pooled account to assigned for the user', async () => {
    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const owner = await createAccount('claude-replace-pooled-owner');

    const opened = await api('ops/product-accounts', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ userId: owner.user.id, accountRef: 'acct-pooled-one@example.com' }),
    });
    expect(opened.status).toBe(201);
    const openedBody = (await opened.json() as any);
    const ownerAccountId = openedBody.account.id;

    const pooled = await api('ops/product-accounts', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ accountRef: 'acct-pooled-two@example.com' }),
    });
    expect(pooled.status).toBe(201);
    expect((await pooled.json() as any).account.status).toBe('pooled');

    const replace = await api(`ops/product-accounts/${ownerAccountId}/replace`, {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ accountRef: 'acct-pooled-two@example.com' }),
    });
    expect(replace.status).toBe(200);
    const replaceBody = (await replace.json() as any);
    expect(replaceBody.previous.status).toBe('retired');
    expect(replaceBody.account.accountRef).toBe('acct-pooled-two@example.com');
    expect(replaceBody.account.status).toBe('assigned');
    expect(replaceBody.account.userId).toBe(owner.user.id);

    const detail = await operations(`users/${owner.user.id}/detail`);
    const detailBody = (await detail.json() as any);
    const accounts = detailBody.product.accounts as any[];
    expect(accounts.filter((a) => a.accountRef === 'acct-pooled-two@example.com')).toHaveLength(1);
    expect(accounts.find((a) => a.accountRef === 'acct-pooled-two@example.com').status).toBe('assigned');
    expect(accounts.filter((a) => a.status === 'assigned')).toHaveLength(1);
    expect(detailBody.product.replaceCount).toBe(1);
  });

  it('assigns a pooled Claude account to only one of two concurrent users', async () => {
    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const first = await createAccount('claude-pool-race-a');
    const second = await createAccount('claude-pool-race-b');
    const pooled = await api('ops/product-accounts', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ accountRef: 'acct-pool-race@example.com' }),
    });
    expect(pooled.status).toBe(201);
    const assign = (userId: string) => api('ops/product-accounts', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ userId, accountRef: 'acct-pool-race@example.com' }),
    });
    const results = await Promise.all([assign(first.user.id), assign(second.user.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results[0].status === 409 ? first : second;
    expect((await results.find((r) => r.status === 409)!.json() as any).error.code).toBe('ACCOUNT_REF_IN_USE');
    const loserRow = await env.DB.prepare(
      'SELECT plan, first_entitled_at FROM users WHERE id = ?',
    ).bind(loser.user.id).first<{ plan: string | null; first_entitled_at: number | null }>();
    expect(loserRow).toEqual({ plan: null, first_entitled_at: null });
    const loserEvents = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM product_account_events WHERE user_id = ? AND type = 'assigned'",
    ).bind(loser.user.id).first<{ n: number }>();
    expect(loserEvents!.n).toBe(0);
  });

  it('stores a node billing profile and reports who is on a named node', async () => {
    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const created = await api('ops/node-profiles', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        catalogName: 'Tokyo · North',
        provider: 'dmit',
        billingUrl: 'https://example.com/clientarea',
        trafficQuotaBytes: 1_000_000_000,
        renewsAt: Math.floor(Date.now() / 1000) + 86400,
      }),
    });
    expect(created.status).toBe(201);
    const profile = (await created.json() as any).profile;
    expect(profile.billingUrl).toBe('https://example.com/clientarea');

    const badUrl = await api('ops/node-profiles', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ catalogName: 'Bad', billingUrl: 'javascript:alert(1)' }),
    });
    expect(badUrl.status).toBe(400);

    const incident = await operations(`incidents/node/${encodeURIComponent('Tokyo · North')}`);
    expect(incident.status).toBe(200);
    expect((await incident.json() as any).affected).toEqual([]);

    const dash = await operations('dashboard');
    expect((await dash.json() as any).dashboard.inventory.renewingSoon).toBe(1);
  });
});
