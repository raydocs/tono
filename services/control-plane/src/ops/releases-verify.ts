//
// A release row used to be a catalogue entry: someone typed a version and the
// console called it published. Nothing tied the row to the bytes an updater
// would download, so a typo in the digest, a build that never finished
// uploading, and a real release all looked the same from the operator's chair —
// and the first two only announce themselves as a client that cannot update.
//
// Everything here is the check that closes that gap: the object exists, it is
// the size the row claims, it hashes to the digest the row claims, and — for
// the two platforms whose updater actually verifies a signature — the signature
// is at least the right shape before it is stored.

import { ApiError } from '../errors';
import type { Platform, UpdateChannelKind } from './contract';

type ChannelShape = {
  kind: UpdateChannelKind | null;
  feedPath: string | null;
  wired: boolean;
};

/**
 * 每个平台的更新源：有没有更新器，喂哪条 feed，Worker 是不是真的在渲染它。
 *
 * It lives here, beside the signature shapes, because `kind` is exactly what
 * decides which signature a build must carry — and because `releases.ts` needs
 * the table to refuse an unsigned build while `releases-channels.ts` needs the
 * release lookup, which would otherwise be a cycle between the two.
 */
export const UPDATE_CHANNELS: Record<Platform, ChannelShape> = {
  macos: { kind: 'sparkle', feedPath: '/appcast.xml', wired: true },
  windows: { kind: 'tauri', feedPath: '/windows/latest.json', wired: true },
  linux: { kind: null, feedPath: null, wired: false },
  android: { kind: null, feedPath: null, wired: false },
  ios: { kind: null, feedPath: null, wired: false },
};

/** Bytes an Ed25519 signature decodes to; Sparkle's `sparkle:edSignature`. */
const ED25519_SIGNATURE_BYTES = 64;
/** minisign's own signature blob, which tauri's updater carries base64'd. */
const MINISIGN_SIGNATURE_BYTES = 74;

export type VerifiedObject = {
  etag: string;
  size: number;
  sha256: string;
};

/** The digest a caller may declare: lowercase hex, no `0X`, no whitespace. */
export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function hex(buffer: ArrayBuffer): string {
  let out = '';
  for (const byte of new Uint8Array(buffer)) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Base64 that round-trips. `atob` happily accepts input the encoder would never
 * produce (missing padding, stray characters in some engines), so a signature
 * that decodes but does not re-encode to itself is rejected rather than stored.
 */
function strictBase64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  let reencoded = '';
  for (const byte of bytes) reencoded += String.fromCharCode(byte);
  return btoa(reencoded) === value ? bytes : null;
}

/** Sparkle: one Base64 token, no whitespace, decoding to 64 Ed25519 bytes. */
export function isSparkleSignature(value: string): boolean {
  const bytes = strictBase64(value.trim());
  return bytes !== null && bytes.byteLength === ED25519_SIGNATURE_BYTES;
}

/**
 * Tauri: the minisign signature box, either as text or base64'd whole — which
 * is how `latest.json` carries it, and what `validate-windows-channel.mjs`
 * hands to the updater. An `untrusted comment:` line, then the signature line
 * (74 bytes: two algorithm bytes, the key id, the Ed25519 signature), then
 * optionally a trusted comment and its global signature.
 */
export function isMinisignSignature(value: string): boolean {
  const direct = minisignBox(value);
  if (direct) return true;
  const decoded = strictBase64(value.trim());
  if (!decoded) return false;
  return minisignBox(new TextDecoder().decode(decoded));
}

function minisignBox(text: string): boolean {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length !== 2 && lines.length !== 4) return false;
  if (!lines[0].startsWith('untrusted comment: ')) return false;
  const signature = strictBase64(lines[1]);
  if (!signature || signature.byteLength !== MINISIGN_SIGNATURE_BYTES) return false;
  if (lines.length === 2) return true;
  if (!lines[2].startsWith('trusted comment: ')) return false;
  const global = strictBase64(lines[3]);
  return global !== null && global.byteLength === ED25519_SIGNATURE_BYTES;
}

/**
 * The signature a platform's updater will actually check, refused early when it
 * is not even the right shape. A wrong-shape signature stored now is an update
 * every client silently rejects later, which is the failure this whole file
 * exists to stop being invisible.
 */
export function assertSignatureShape(platform: Platform, signature: string): string {
  const kind = UPDATE_CHANNELS[platform]?.kind;
  if (kind === 'sparkle' && !isSparkleSignature(signature)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid signature: expected a Sparkle EdDSA signature');
  }
  if (kind === 'tauri' && !isMinisignSignature(signature)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid signature: expected a minisign signature');
  }
  return signature;
}

/**
 * Is the object really there, is it the size the row claims, and does it hash
 * to the digest the row claims?
 *
 * R2 records a SHA-256 for objects uploaded with one, and that is taken when
 * present — the bucket computed it over the bytes it stored, which is the same
 * question, answered without moving them. Otherwise the body is streamed
 * through `DigestStream` up to 300 MB; `arrayBuffer()` would pull a large installer
 * into the isolate's memory to compute a 32-byte answer.
 */
export async function verifyReleaseObject(
  bucket: R2Bucket,
  key: string | null | undefined,
  sha256: string | null | undefined,
  sizeBytes: number | null | undefined,
): Promise<VerifiedObject> {
  if (!key) {
    throw new ApiError(409, 'RELEASE_UNVERIFIED', 'No R2 key specified for this release', { reason: 'no_r2_key' });
  }
  const head = await bucket.head(key);
  if (!head) {
    throw new ApiError(409, 'RELEASE_UNVERIFIED', `No object at ${key} in the release bucket`, { reason: 'missing_object' });
  }
  if (sizeBytes == null || head.size !== sizeBytes) {
    throw new ApiError(
      409,
      'RELEASE_UNVERIFIED',
      `The object at ${key} is ${head.size} bytes, not ${sizeBytes}`,
      { reason: 'size_mismatch' },
    );
  }
  if (!sha256) {
    throw new ApiError(409, 'RELEASE_UNVERIFIED', 'No sha256 specified for this release', { reason: 'sha256_mismatch' });
  }
  let digest: string;
  if (head.customMetadata?.sha256) {
    digest = head.customMetadata.sha256;
  } else if (head.checksums?.sha256) {
    digest = hex(head.checksums.sha256);
  } else {
    if (head.size > 300 * 1024 * 1024) {
      throw new ApiError(
        409,
        'RELEASE_UNVERIFIED',
        `The object at ${key} exceeds the 300 MB limit for on-the-fly digest computation`,
        { reason: 'size_mismatch' },
      );
    }
    digest = await streamDigest(bucket, key);
  }
  if (digest.toLowerCase() !== sha256.toLowerCase()) {
    throw new ApiError(
      409,
      'RELEASE_UNVERIFIED',
      `The object at ${key} hashes to ${digest}, not ${sha256}`,
      { reason: 'sha256_mismatch' },
    );
  }
  return { etag: head.etag, size: head.size, sha256: digest };
}

async function streamDigest(bucket: R2Bucket, key: string): Promise<string> {
  const object = await bucket.get(key);
  if (!object) {
    throw new ApiError(409, 'RELEASE_UNVERIFIED', `No object at ${key} in the release bucket`, { reason: 'missing_object' });
  }
  const digestStream = (crypto as unknown as {
    DigestStream?: new (algorithm: string) => WritableStream<ArrayBuffer | ArrayBufferView> & {
      readonly digest: Promise<ArrayBuffer>;
    };
  }).DigestStream;
  if (digestStream) {
    const stream = new digestStream('SHA-256');
    await object.body.pipeTo(stream);
    return hex(await stream.digest);
  }
  const reader = object.body.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.length;
  }
  const digest = await crypto.subtle.digest('SHA-256', combined);
  return hex(digest);
}
