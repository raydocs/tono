type JsonWebKeySet = { keys: JsonWebKey[] };
type SigningJWK = JsonWebKey & { kid: string };

export type AccessFailure = 'misconfigured' | 'unauthorized' | 'forbidden' | 'unavailable';

export class AccessVerificationError extends Error {
  constructor(public readonly failure: AccessFailure) {
    super(failure);
  }
}

export interface AccessConfiguration {
  teamDomain?: string;
  audience?: string;
  adminEmails?: string;
}

interface CachedKeys {
  expiresAt: number;
  fetchedAt: number;
  keys: SigningJWK[];
}

const keyCache = new Map<string, CachedKeys>();
const decoder = new TextDecoder('utf-8', { fatal: true });

function configured(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
    throw new AccessVerificationError('misconfigured');
  }
  return value;
}

function configuration(raw: AccessConfiguration) {
  const teamDomain = configured(raw.teamDomain, 253).trim().toLowerCase();
  const audience = configured(raw.audience, 512).trim();
  const emailList = configured(raw.adminEmails, 4_096).split(',').map((value) => value.trim().toLowerCase());
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(teamDomain) ||
    !/^[A-Za-z0-9_-]{16,512}$/.test(audience) ||
    emailList.length < 1 ||
    emailList.some((value) => value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
  ) {
    throw new AccessVerificationError('misconfigured');
  }
  return {
    audience,
    issuer: `https://${teamDomain}`,
    adminEmails: new Set(emailList),
  };
}

function decodeBase64URL(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 64_000) {
    throw new AccessVerificationError('unauthorized');
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    throw new AccessVerificationError('unauthorized');
  }
}

function decodeObject(value: string): Record<string, unknown> {
  try {
    const decoded = JSON.parse(decoder.decode(decodeBase64URL(value)));
    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error();
    return decoded as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AccessVerificationError) throw error;
    throw new AccessVerificationError('unauthorized');
  }
}

function validJWK(value: unknown): value is SigningJWK {
  if (value === null || typeof value !== 'object') return false;
  const key = value as Record<string, unknown>;
  return key.kty === 'RSA' &&
    typeof key.kid === 'string' && key.kid.length >= 1 && key.kid.length <= 200 &&
    typeof key.n === 'string' && key.n.length >= 128 && key.n.length <= 4_096 &&
    typeof key.e === 'string' && key.e.length >= 2 && key.e.length <= 16 &&
    (key.use === undefined || key.use === 'sig') &&
    (key.alg === undefined || key.alg === 'RS256');
}

function cacheSeconds(header: string | null): number {
  const match = header?.match(/(?:^|,)\s*max-age=(\d+)\b/i);
  const parsed = match ? Number(match[1]) : 300;
  return Number.isSafeInteger(parsed) ? Math.min(3_600, Math.max(60, parsed)) : 300;
}

async function fetchKeys(url: string, force = false): Promise<SigningJWK[]> {
  const currentTime = Date.now();
  const current = keyCache.get(url);
  if (current && current.expiresAt > currentTime && (!force || current.fetchedAt > currentTime - 60_000)) {
    return current.keys;
  }
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'manual' });
  } catch {
    throw new AccessVerificationError('unavailable');
  }
  if (!response.ok || response.type === 'opaqueredirect') {
    throw new AccessVerificationError('unavailable');
  }
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > 256 * 1024) {
    throw new AccessVerificationError('unavailable');
  }
  const raw = await response.text();
  if (raw.length > 256 * 1024) throw new AccessVerificationError('unavailable');
  let parsed: JsonWebKeySet;
  try {
    parsed = JSON.parse(raw) as JsonWebKeySet;
  } catch {
    throw new AccessVerificationError('unavailable');
  }
  if (!Array.isArray(parsed?.keys) || parsed.keys.length < 1 || parsed.keys.length > 20) {
    throw new AccessVerificationError('unavailable');
  }
  const keys = parsed.keys.filter(validJWK);
  if (keys.length < 1) throw new AccessVerificationError('unavailable');
  keyCache.set(url, {
    fetchedAt: currentTime,
    expiresAt: currentTime + cacheSeconds(response.headers.get('cache-control')) * 1_000,
    keys,
  });
  return keys;
}

function audienceMatches(value: unknown, expected: string): boolean {
  return value === expected ||
    (Array.isArray(value) && value.length >= 1 && value.every((item) => typeof item === 'string') && value.includes(expected));
}

export async function verifyAccessRequest(
  request: Request,
  rawConfiguration: AccessConfiguration,
  currentTime = Math.floor(Date.now() / 1_000),
): Promise<{ email: string; subject: string }> {
  const { issuer, audience, adminEmails } = configuration(rawConfiguration);
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token || token.length < 100 || token.length > 16_384 || /\s/.test(token)) {
    throw new AccessVerificationError('unauthorized');
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new AccessVerificationError('unauthorized');
  }
  const header = decodeObject(parts[0]);
  const claims = decodeObject(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length < 1 || header.kid.length > 200) {
    throw new AccessVerificationError('unauthorized');
  }
  const keyURL = `${issuer}/cdn-cgi/access/certs`;
  let keys = await fetchKeys(keyURL);
  let jwk = keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) {
    keys = await fetchKeys(keyURL, true);
    jwk = keys.find((candidate) => candidate.kid === header.kid);
  }
  if (!jwk) throw new AccessVerificationError('unauthorized');
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch {
    throw new AccessVerificationError('unavailable');
  }
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeBase64URL(parts[2]).buffer as ArrayBuffer,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new AccessVerificationError('unauthorized');
  const expiresAt = claims.exp;
  const issuedAt = claims.iat;
  const notBefore = claims.nbf;
  if (
    claims.iss !== issuer ||
    !audienceMatches(claims.aud, audience) ||
    !Number.isSafeInteger(expiresAt) || Number(expiresAt) <= currentTime ||
    !Number.isSafeInteger(issuedAt) || Number(issuedAt) > currentTime + 60 ||
    (notBefore !== undefined && (!Number.isSafeInteger(notBefore) || Number(notBefore) > currentTime + 60)) ||
    typeof claims.sub !== 'string' || claims.sub.length < 1 || claims.sub.length > 255 ||
    typeof claims.email !== 'string'
  ) {
    throw new AccessVerificationError('unauthorized');
  }
  const accessEmail = claims.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accessEmail) || accessEmail.length > 254) {
    throw new AccessVerificationError('unauthorized');
  }
  if (!adminEmails.has(accessEmail)) throw new AccessVerificationError('forbidden');
  return { email: accessEmail, subject: claims.sub };
}
