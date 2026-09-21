// Shared by collector results and immediate connection-failure ingestion.
// Redact before truncation, while credential labels and values are still whole.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Redact the assignment, not just its label; preserve the surrounding cause.
const PASSWORD_RE = /\bpassword\b(?:["']?\s*[:=]\s*(?:"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|[^\s,;}\]]+))?/gi;

export function redactJobResult(text: string, allowlistedIp?: string | null): string {
  const allow = typeof allowlistedIp === 'string' && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(allowlistedIp) ? allowlistedIp : null;
  for (const re of [UUID_RE, EMAIL_RE, IPV4_RE, PASSWORD_RE]) re.lastIndex = 0;
  return text
    .replace(PASSWORD_RE, '[redacted]')
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
      key.toLowerCase() === 'password' ? '[redacted]' : redactJobValue(item, allowlistedIp),
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
