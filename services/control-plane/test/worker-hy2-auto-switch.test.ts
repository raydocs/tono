// A18 / D1-C: hy2 auto-switch is on for internal accounts only, off for every
// other account, and the operator's global switch reaches the rest without
// overriding a per-account "off".
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/index';
import {
  api,
  admin,
  accessAssertion,
  createAccount,
  acknowledgeServedExits,
  ACCESS_ADMIN_EMAIL,
  useWorkerHarness,
} from './worker-harness';

const CATALOG = `proxies:
  - name: Tokyo · Sakura
    type: vless
    server: 8.8.8.8
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
  - name: Tokyo · Sakura · hy2
    type: hysteria2
    server: 8.8.8.8
    port: 443
    password: {{TONO_CLIENT_UUID}}
    sni: www.microsoft.com
    fingerprint: e3aa4a745aa90539ab1a493d940eeba7b4305b7516ab84167e46c98ad9fed3db
`;

async function put(path: string, value: unknown) {
  return api(`ops/${path}`, {
    method: 'PUT',
    headers: {
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
      'content-type': 'application/json',
    },
    body: JSON.stringify(value),
  });
}

async function served(token: string, acceptHy2 = true) {
  const response = await api('exit-catalog', {
    headers: { authorization: `Bearer ${token}`, ...(acceptHy2 ? { 'X-Tono-Accept': 'hy2' } : {}) },
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ yaml: string; hy2AutoSwitch?: boolean }>;
}

describe('hy2 auto-switch', () => {
  useWorkerHarness();

  it('is on for internal accounts only, and the global switch reaches others without beating a per-account off', async () => {
    expect((await admin('exit-catalog', { yaml: CATALOG, expectedRevision: 0 }, 'PUT')).status).toBe(200);
    await acknowledgeServedExits('Tokyo · Sakura');
    const internal = await createAccount('hy2-internal');
    const other = await createAccount('hy2-other');
    const pinnedOff = await createAccount('hy2-pinned-off');
    const yamlBefore = (await served(other.accessToken)).yaml;

    expect((await put(`users/${internal.user.id}/hy2-auto-switch`, { internalAccount: true })).status).toBe(200);
    expect((await served(internal.accessToken)).hy2AutoSwitch).toBe(true);
    expect((await served(other.accessToken)).hy2AutoSwitch).toBe(false);
    // A client that did not declare hy2 gets no hy2 block, so no permission.
    expect((await served(internal.accessToken, false)).hy2AutoSwitch).toBe(false);

    // The global switch is settings.publish: an operator may mark accounts, not flip everyone.
    (env as unknown as Env).OPS_ROLES = JSON.stringify({ [ACCESS_ADMIN_EMAIL]: 'operator' });
    try {
      expect((await put('hy2-auto-switch', { allAccounts: true })).status).toBe(403);
      expect((await put(`users/${pinnedOff.user.id}/hy2-auto-switch`, { override: 'off' })).status).toBe(200);
    } finally {
      (env as unknown as Env).OPS_ROLES = undefined;
    }
    expect((await put('hy2-auto-switch', { allAccounts: true })).status).toBe(200);
    expect((await served(other.accessToken)).hy2AutoSwitch).toBe(true);
    expect((await served(pinnedOff.accessToken)).hy2AutoSwitch).toBe(false);
    expect((await served(internal.accessToken)).hy2AutoSwitch).toBe(true);

    // Membership never moves: same entries before and after, for every account.
    expect((await served(other.accessToken)).yaml).toBe(yamlBefore);
    const audit = await (env as unknown as Env).DB.prepare(
      "SELECT action, target_id FROM ops_audit WHERE action LIKE '%hy2-auto-switch%' ORDER BY at, action",
    ).all<{ action: string; target_id: string }>();
    expect(audit.results.map((row) => row.action).sort()).toEqual([
      'hy2-auto-switch.global', 'user.hy2-auto-switch', 'user.hy2-auto-switch',
    ]);
  });
});
