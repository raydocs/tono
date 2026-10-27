#!/usr/bin/env node
// Real-mailbox check of Tono email sign-in (decision 138): a disposable mail.tm
// inbox requests a code from the control plane, waits for the mail, then
// verifies a wrong code and the real one, and deletes the inbox.
//
//   node tooling/scripts/public-signup-e2e.mjs [--api https://api.afk.ccwu.cc] [--wait 120]
//
// With open registration on, a delivered code creates a real account with no
// plan in that deployment's D1, so run it against production only when the
// task names it. With it off, the expected result is "no mail", the closed
// path. Prints no secrets; the inbox password is random and discarded.
import { randomBytes, randomUUID } from 'node:crypto';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const api = `${arg('api', 'https://api.afk.ccwu.cc').replace(/\/$/, '')}/api/v1`;
const waitSeconds = Number(arg('wait', '120'));
const mailTm = 'https://api.mail.tm';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  return { status: response.status, body };
}
const post = (url, body, headers) => call(url, { method: 'POST', body: JSON.stringify(body), headers });

const methods = await call(`${api}/auth/methods`);
console.log('auth/methods', methods.status, JSON.stringify(methods.body?.email));

const domain = (await call(`${mailTm}/domains`)).body?.['hydra:member']?.find((d) => d.isActive)?.domain;
if (!domain) throw new Error('mail.tm has no active domain');
const address = `tono-e2e-${randomBytes(5).toString('hex')}@${domain}`;
const password = randomBytes(18).toString('base64url');
const created = await post(`${mailTm}/accounts`, { address, password });
if (created.status !== 201) throw new Error(`mail.tm account: ${created.status}`);
const token = (await post(`${mailTm}/token`, { address, password })).body?.token;
const inbox = { authorization: `Bearer ${token}` };

try {
  const started = await post(`${api}/auth/email/start`, {
    email: address,
    deviceName: 'Tono signup e2e',
    installationId: `signup-e2e-${randomUUID()}`,
  });
  console.log('auth/email/start', started.status, JSON.stringify({
    publicSignup: started.body?.publicSignup,
    expiresIn: started.body?.expiresIn,
  }));
  if (started.status !== 202) process.exit(1);

  let code;
  let from;
  const deadline = Date.now() + waitSeconds * 1000;
  while (!code && Date.now() < deadline) {
    await sleep(5000);
    const [first] = (await call(`${mailTm}/messages`, { headers: inbox })).body?.['hydra:member'] ?? [];
    if (!first) continue;
    const message = (await call(`${mailTm}/messages/${first.id}`, { headers: inbox })).body;
    from = message?.from?.address;
    code = String(message?.text ?? '').match(/\b(\d{6})\b/)?.[1];
  }
  if (!code) {
    console.log(`mail: none within ${waitSeconds}s`);
    process.exit(0);
  }
  console.log(`mail: code received from ${from}`);

  const wrong = await post(`${api}/auth/email/verify`, {
    challengeId: started.body.challengeId,
    code: code === '000000' ? '000001' : '000000',
  });
  console.log('verify wrong code', wrong.status, wrong.body?.error?.code);
  const verified = await post(`${api}/auth/email/verify`, { challengeId: started.body.challengeId, code });
  console.log('verify real code', verified.status, verified.body?.error?.code ?? 'tokens issued');
  const replay = await post(`${api}/auth/email/verify`, { challengeId: started.body.challengeId, code });
  console.log('verify replay', replay.status, replay.body?.error?.code);
} finally {
  const id = (await call(`${mailTm}/me`, { headers: inbox })).body?.id;
  if (id) await call(`${mailTm}/accounts/${id}`, { method: 'DELETE', headers: inbox });
}
