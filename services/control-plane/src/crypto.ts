const enc = new TextEncoder();
const dec = new TextDecoder();
const b64u = (b: ArrayBuffer | Uint8Array) => {
  const a = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ''; for (const x of a) s += String.fromCharCode(x);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const catalogAAD = enc.encode('tono-managed-exit-catalog-v1');
const trafficPolicyAAD = enc.encode('tono-managed-traffic-policy-v1');

async function catalogKey(encodedKey: string, usage: KeyUsage[]) {
  const raw = unb64u(encodedKey);
  if (raw.byteLength !== 32) throw new Error('Catalog key must contain exactly 32 bytes');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usage);
}

// What an Ed25519 policy signature actually covers.
//
// Standard base64 rather than the base64url used elsewhere in this file, because
// this value is produced on an operator's machine and consumed by two clients in
// two other languages; standard base64 is what `Data(base64Encoded:)`, Rust's
// STANDARD engine, and `atob` all accept without a conversion step, and it is the
// encoding the update feed's EdDSA signatures already use.
//
// The context prefix is part of the signed bytes. Without it a signature made by
// this key over some other document could be presented as a policy signature; a
// key that only ever signs policies today does not stay that way. All three
// implementations must prefix identically or nothing verifies — this constant is
// the single definition, mirrored in sign-traffic-policy.mjs, AppState.swift, and
// policy.rs, each pointing back here.
export const TRAFFIC_POLICY_SIGNATURE_CONTEXT = 'tono-traffic-policy-v1\n';

const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Returns false for anything that is not a good signature by the given key,
// including a malformed key, a malformed signature, and a signature of the right
// shape over different bytes. Callers must treat all of those identically: a
// document whose signature does not verify is a document of unknown authorship,
// and the reason it failed is not the caller's decision to make.
export async function verifyTrafficPolicySignature(
  json: string,
  signature: string,
  encodedPublicKey: string,
): Promise<boolean> {
  try {
    const raw = unb64(encodedPublicKey);
    if (raw.byteLength !== 32) return false;
    const sig = unb64(signature);
    if (sig.byteLength !== 64) return false;
    const key = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      sig,
      enc.encode(TRAFFIC_POLICY_SIGNATURE_CONTEXT + json),
    );
  } catch {
    return false;
  }
}

export const randomToken = (bytes = 32) => b64u(crypto.getRandomValues(new Uint8Array(bytes)));
export async function sha256(s: string) { return b64u(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
export async function hmacSha256(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}
export async function jwtSign(payload: object, secret: string) {
  const h=b64u(enc.encode(JSON.stringify({alg:'HS256',typ:'JWT'}))), p=b64u(enc.encode(JSON.stringify(payload)));
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return `${h}.${p}.${b64u(await crypto.subtle.sign('HMAC',key,enc.encode(`${h}.${p}`)))}`;
}
export async function jwtVerify(token: string, secret: string): Promise<any|null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((x) => x.length === 0)) return null;
    const [h, p, s] = parts;
    const header = JSON.parse(new TextDecoder().decode(unb64u(h)));
    if (header?.alg !== 'HS256' || header?.typ !== 'JWT') return null;
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      {name:'HMAC',hash:'SHA-256'},
      false,
      ['verify'],
    );
    if (!await crypto.subtle.verify('HMAC', key, unb64u(s), enc.encode(`${h}.${p}`))) return null;
    const v = JSON.parse(new TextDecoder().decode(unb64u(p)));
    return v && typeof v === 'object' && Number.isSafeInteger(v.exp) &&
      v.exp > Math.floor(Date.now()/1000) ? v : null;
  } catch { return null; }
}

export async function encryptCatalog(plaintext: string, encodedKey: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await catalogKey(encodedKey, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: catalogAAD },
    key,
    enc.encode(plaintext),
  );
  return { nonce: b64u(nonce), ciphertext: b64u(ciphertext) };
}

export async function decryptCatalog(
  ciphertext: string,
  nonce: string,
  encodedKey: string,
) {
  const decodedNonce = unb64u(nonce);
  if (decodedNonce.byteLength !== 12) throw new Error('Invalid catalog nonce');
  const key = await catalogKey(encodedKey, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodedNonce, additionalData: catalogAAD },
    key,
    unb64u(ciphertext),
  );
  return dec.decode(plaintext);
}

export async function encryptTrafficPolicy(plaintext: string, encodedKey: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await catalogKey(encodedKey, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: trafficPolicyAAD },
    key,
    enc.encode(plaintext),
  );
  return { nonce: b64u(nonce), ciphertext: b64u(ciphertext) };
}

export async function decryptTrafficPolicy(ciphertext: string, nonce: string, encodedKey: string) {
  const decodedNonce = unb64u(nonce);
  if (decodedNonce.byteLength !== 12) throw new Error('Invalid traffic policy nonce');
  const key = await catalogKey(encodedKey, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodedNonce, additionalData: trafficPolicyAAD },
    key,
    unb64u(ciphertext),
  );
  return dec.decode(plaintext);
}
