// Shared by collector results and immediate connection-failure ingestion.
// Redact before truncation, while credential labels and values are still whole.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Redact the assignment, not just its label; preserve the surrounding cause.
const PASSWORD_RE = /\bpassword\b(?:["']?\s*[:=]\s*(?:"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|[^\s,;}\]]+))?/gi;
// Same credential shapes the Windows audit redactor strips (audit.rs REDACTIONS);
// this is the last pass before D1 and the ops console, so older or other clients
// that skip it still never store a session credential.
// Authorization takes the scheme and one credential, so the cause after it survives;
// a Cookie value can hold `; ` pairs, so it runs to the end of the line.
const AUTH_HEADER_RE = /\bauthorization\s*:\s*(?:[a-z]+\s+)?[^\s",;]+|\bcookie\s*:\s*[^\n"]*/gi;
const BEARER_RE = /\bbearer\s+[^\s"',]+/gi;
// Quotes on either side cover JSON, Python-repr and escaped-JSON shapes.
const TOKEN_RE = /(?:access|refresh|id|session|auth)?[-_]?token["'\\]*\s*[:=]\s*["'\\]*[^\s"'\\,&;}]+/gi;
const SECRET_RE = /\b(?:x-)?(?:api[-_]?key|client[-_]?secret|secret)["'\\]*\s*[:=]\s*["'\\]*[^\s"'\\,&;}]+/gi;
const URL_USERINFO_RE = /:\/\/[^/@\s"]+@/g;
// Full eight-group or `::`-compressed IPv6 (client and home addresses identify a
// household). Hex-only groups bounded by non-word characters keep clock times
// (12:30:45) and Rust paths (tono_core::connection) intact. A bare prefix
// (`2001:db8:1234::`) or a leading `::` form needs two groups, so `::1` and
// one-word Rust paths stay.
const IPV6_RE = /(?<![0-9a-z:])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,6}(?::[0-9a-f]{1,4}){1,6}|(?:[0-9a-f]{1,4}:){2,7}:|::(?:[0-9a-f]{1,4}:){1,5}[0-9a-f]{1,4})(?![0-9a-z:])/gi;
// Object keys whose whole value is a credential, whatever its shape; matched
// after removing `-` and `_` and lowercasing.
const SECRET_KEYS = new Set([
  'password', 'passwd', 'secret', 'clientsecret', 'apikey', 'xapikey', 'privatekey',
  'authorization', 'cookie', 'setcookie',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'sessiontoken', 'authtoken',
]);

export function redactJobResult(text: string, allowlistedIp?: string | null): string {
  const allow = typeof allowlistedIp === 'string' && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(allowlistedIp) ? allowlistedIp : null;
  for (const re of [UUID_RE, EMAIL_RE, IPV4_RE, PASSWORD_RE, AUTH_HEADER_RE, BEARER_RE, TOKEN_RE, SECRET_RE, URL_USERINFO_RE, IPV6_RE]) re.lastIndex = 0;
  return text
    .replace(AUTH_HEADER_RE, '[redacted]')
    .replace(BEARER_RE, '[redacted]')
    .replace(TOKEN_RE, '[redacted]')
    .replace(SECRET_RE, '[redacted]')
    .replace(URL_USERINFO_RE, '://[redacted]@')
    .replace(PASSWORD_RE, '[redacted]')
    .replace(IPV6_RE, '[redacted]')
    .replace(UUID_RE, '[redacted]')
    .replace(EMAIL_RE, '[redacted]')
    .replace(IPV4_RE, (match) => (allow && match === allow ? match : '[redacted]'));
}

function redactJobValue(value: unknown, allowlistedIp?: string | null): unknown {
  if (typeof value === 'string') return redactJobResult(value, allowlistedIp);
  if (Array.isArray(value)) return value.map((item) => redactJobValue(item, allowlistedIp));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      redactJobResult(key, allowlistedIp),
      SECRET_KEYS.has(key.replace(/[-_]/g, '').toLowerCase()) ? '[redacted]' : redactJobValue(item, allowlistedIp),
    ]));
  }
  return value;
}

export function redactJobJson(value: unknown, allowlistedIp?: string | null): string {
  // The result contract accepts encoded JSON or plain text. Decode structured
  // results before redacting so escaped quotes and object keys stay valid JSON.
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return redactJobResult(value as string, allowlistedIp);
    }
  }
  return JSON.stringify(redactJobValue(value, allowlistedIp));
}
