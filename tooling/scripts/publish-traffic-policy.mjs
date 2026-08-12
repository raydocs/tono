#!/usr/bin/env node
// Publish a managed traffic policy, signing it offline when it needs a signature.
//
// The private key never leaves this machine and never reaches the Worker. That is
// the whole point of signing: if the Worker could sign, taking the Worker would be
// enough to publish a policy that pulls arbitrary hosts out of every user's
// tunnel, and the compiled-in allowlists this replaces exist precisely to prevent
// that. So the key lives in the login keychain and is read here, at publish time,
// by the operator who already has it unlocked.
//
// Flow, and why it has two round trips:
//
//   1. Ask the Worker what it would serve for this policy (`dryRun`). The signed
//      bytes must be the *served* bytes, and those are the Worker's canonical
//      output — sorted hosts, normalised ports — not the file on disk. Asking
//      rather than reimplementing canonicalisation is what keeps the two from
//      drifting apart into a signature that verifies nowhere.
//   2. Sign those exact bytes and publish. The Worker re-canonicalises and
//      re-verifies, so if anything differed between the two calls the signature
//      fails and nothing is stored.
//
// A policy whose hosts the allowlists already cover needs no signature, and the
// dry run says so. Most republishes are that case and stay a single unsigned PUT.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

// Mirrors TRAFFIC_POLICY_SIGNATURE_CONTEXT in services/control-plane/src/crypto.ts.
// Part of the signed bytes; all four implementations must agree exactly.
const SIGNATURE_CONTEXT = 'tono-traffic-policy-v1\n';
const KEYCHAIN_SERVICE = 'tono-policy-signing';

const usage = () => {
  process.stderr.write(`usage: publish-traffic-policy.mjs --policy <file> [--api <base>] [--publish]

  Without --publish: asks what would be served, reports whether a signature is
  required, signs it, verifies the signature locally, and stops. Nothing is
  stored.

  With --publish: also PUTs the policy, with a signature when one is needed.

  --api defaults to https://api.afk.ccwu.cc
  The admin token is read from the keychain (service tono-admin).
  The signing key is read from the keychain (service ${KEYCHAIN_SERVICE}).
`);
};

const args = process.argv.slice(2);
let policyPath = '';
let api = 'https://api.afk.ccwu.cc';
let publish = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--policy') { policyPath = args[i + 1] ?? ''; i += 1; }
  else if (args[i] === '--api') { api = args[i + 1] ?? ''; i += 1; }
  else if (args[i] === '--publish') { publish = true; }
  else if (args[i] === '-h' || args[i] === '--help') { usage(); process.exit(0); }
  else { usage(); process.exit(2); }
}
if (!policyPath) { usage(); process.exit(2); }

const fail = (message) => {
  process.stderr.write(`publish-traffic-policy: ${message}\n`);
  process.exit(1);
};

const keychain = (service) => {
  try {
    return execFileSync('security', [
      'find-generic-password', '-a', process.env.USER ?? '', '-s', service, '-w',
    ], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

const policy = (() => {
  try {
    return JSON.parse(readFileSync(policyPath, 'utf8'));
  } catch (error) {
    fail(`could not read a policy from ${policyPath}: ${error.message}`);
  }
})();

const adminToken = keychain('tono-admin');
if (!adminToken) fail('no admin token in the keychain (service tono-admin)');

const request = async (payload) => {
  const response = await fetch(`${api}/api/v1/admin/traffic-policy`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: response.status, body };
};

process.stdout.write('── asking what would be served\n');
const preview = await request({ policy, dryRun: true });
if (preview.status !== 200) {
  fail(`the dry run was refused (${preview.status}): ${JSON.stringify(preview.body)}`);
}
const canonical = preview.body.json;
if (typeof canonical !== 'string' || !canonical.length) {
  fail('the dry run returned no canonical document');
}
// A context the server disagrees with means a signature made here verifies
// nowhere. Better to stop than to publish a document nothing accepts.
if (preview.body.signatureContext !== SIGNATURE_CONTEXT) {
  fail(`the server signs over ${JSON.stringify(preview.body.signatureContext)}, this tool over ${JSON.stringify(SIGNATURE_CONTEXT)}`);
}
const parsed = JSON.parse(canonical);
const counts = ['domains', 'webDomains', 'directSuffixes', 'tcpEndpoints', 'mediaEndpoints']
  .filter((field) => Array.isArray(parsed[field]))
  .map((field) => `${field} ${parsed[field].length}`)
  .join(', ');
process.stdout.write(`  version ${parsed.version}: ${counts}\n`);
process.stdout.write(`  sha256 ${preview.body.sha256}\n`);
process.stdout.write(`  signature ${preview.body.signatureRequired ? 'required' : 'not required'}\n`);

let signature;
if (preview.body.signatureRequired) {
  const pkcs8 = keychain(KEYCHAIN_SERVICE);
  if (!pkcs8) {
    fail(`this policy needs a signature but no signing key is in the keychain (service ${KEYCHAIN_SERVICE})`);
  }
  process.stdout.write('── signing, offline\n');
  const message = new TextEncoder().encode(SIGNATURE_CONTEXT + canonical);
  let raw;
  try {
    const key = await webcrypto.subtle.importKey(
      'pkcs8', Buffer.from(pkcs8, 'base64'), { name: 'Ed25519' }, false, ['sign'],
    );
    raw = await webcrypto.subtle.sign('Ed25519', key, message);
  } catch (error) {
    fail(`the signing key could not be used: ${error.message}`);
  }
  signature = Buffer.from(raw).toString('base64');

  // Verified here, against the public key the deployment and the clients were
  // built with, before anything is sent. A signature that only the server can
  // reject costs a round trip to discover; one that the server accepts and the
  // clients reject silently disables managed direct routing fleet-wide.
  const configured = readFileSync(
    new URL('../../services/control-plane/wrangler.jsonc', import.meta.url), 'utf8',
  ).match(/"TRAFFIC_POLICY_PUBLIC_KEY":\s*"([^"]+)"/);
  if (!configured) fail('wrangler.jsonc declares no TRAFFIC_POLICY_PUBLIC_KEY to check against');
  const publicKey = await webcrypto.subtle.importKey(
    'raw', Buffer.from(configured[1], 'base64'), { name: 'Ed25519' }, false, ['verify'],
  );
  if (!await webcrypto.subtle.verify('Ed25519', publicKey, Buffer.from(signature, 'base64'), message)) {
    fail('the signature does not verify against the public key this deployment trusts; the keychain key and TRAFFIC_POLICY_PUBLIC_KEY are not a pair');
  }
  process.stdout.write('  verifies against the key the fleet trusts\n');
}

if (!publish) {
  process.stdout.write('\n── not published (no --publish)\n');
  if (signature) process.stdout.write(`  signature ready: ${signature}\n`);
  process.stdout.write('  Re-run with --publish to store it.\n');
  process.exit(0);
}

process.stdout.write('── publishing\n');
const current = await fetch(`${api}/api/v1/admin/traffic-policy`, {
  headers: { authorization: `Bearer ${adminToken}` },
});
if (!current.ok) fail(`could not read the current revision (${current.status})`);
const expectedRevision = Number((await current.json()).revision ?? 0);
const published = await request({
  policy,
  expectedRevision,
  ...(signature ? { signature } : {}),
});
if (published.status !== 200) {
  fail(`publishing was refused (${published.status}): ${JSON.stringify(published.body)}`);
}
if (published.body.json !== canonical) {
  fail('the published document differs from the one that was signed; nothing can be trusted about this revision — investigate before relying on it');
}
process.stdout.write(`  revision ${published.body.revision}, sha256 ${published.body.sha256}\n`);
process.stdout.write(`  signature ${published.body.signature ? 'stored' : 'none (allowlists cover every host)'}\n`);
