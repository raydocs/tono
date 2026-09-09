import { ApiError } from './errors';
import { type Row, str } from './env';

export function rejectUnexpectedKeys(value: unknown, allowed: string[]): asserts value is Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Expected an object');
  }
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Unexpected field');
  }
}

export const error = (e: unknown) => {
  if (!(e instanceof ApiError)) {
    console.error('Unhandled internal server error:', e);
  }
  const x = e instanceof ApiError ? e : new ApiError(500, 'INTERNAL_ERROR', 'Internal server error');
  return Response.json({ error: { code: x.code, message: x.message } }, { status: x.status });
};

export async function body(req: Request, maxBytes = 1024 * 1024) {
  // A cross-site form POST (enctype=text/plain) is a no-preflight simple
  // request; requiring the JSON media type means every write that reaches a
  // parse is either same-origin or has already survived a CORS preflight.
  const mediaType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected content-type application/json');
  }
  const declared = Number(req.headers.get('content-length') ?? '0');
  const declaredTooLarge = Number.isFinite(declared) && declared > maxBytes;
  try {
    const reader = req.body?.getReader();
    if (!reader && declaredTooLarge) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
    if (!reader) throw new ApiError(400, 'INVALID_JSON', 'Expected a JSON body');
    const chunks: Uint8Array[] = [];
    let total = 0;
    let tooLarge = declaredTooLarge;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        // Drain an oversized stream before responding so neither workerd nor
        // an HTTP sender is left trying to feed an abandoned request body.
        if (tooLarge) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          tooLarge = true;
          chunks.length = 0;
          continue;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    if (tooLarge) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
    const raw = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      raw.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ApiError(400, 'INVALID_JSON', 'Expected a JSON object');
    }
    return value as Row;
  } catch (x) {
    if (x instanceof ApiError) throw x;
    throw new ApiError(400, 'INVALID_JSON', 'Expected a JSON body');
  }
}

export const email = (v: any) => {
  const x = str(v, 'email').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid email');
  }
  return x;
};

export const optionalText = (value: unknown) => value === null || value === undefined ? null : String(value);
export const optionalNumber = (value: unknown) => value === null || value === undefined ? null : Number(value);
