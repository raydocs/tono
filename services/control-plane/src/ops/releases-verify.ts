// 发布必须对应真实更新源：桶里那个对象、对象上的签名、以及哪些平台真有更新器。
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
 * The table below is deliberately a constant rather than a query: which
 * updater a platform ships with is a property of the client, not of the
 * database, and pretending otherwise would let a missing row read as "no
 * updater" when the truth is "we forgot to seed it".
 *
 * `wired` is the field that keeps this honest. macOS and Windows are the two
 * feeds the Worker renders from `client_releases`; the rest have no updater at
 * all, and the console must say 未接 rather than showing a path that answers
 * nothing.
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
  const kind = UPDATE_CHANNELS[platform].kind;
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
 * through `DigestStream`; `arrayBuffer()` would pull a 70 MB installer into the
 * isolate's memory to compute a 32-byte answer.
 */
export async function verifyReleaseObject(
  bucket: R2Bucket,
  key: string,
  sha256: string,
  sizeBytes: number,
): Promise<VerifiedObject> {
  const head = await bucket.head(key);
  if (!head) {
    throw new ApiError(422, 'RELEASE_OBJECT_MISSING', `No object at ${key} in the release bucket`);
  }
  if (head.size !== sizeBytes) {
    throw new ApiError(
      422,
      'RELEASE_SIZE_MISMATCH',
      `The object at ${key} is ${head.size} bytes, not ${sizeBytes}`,
    );
  }
  const recorded = head.checksums?.sha256;
  const digest = recorded ? hex(recorded) : await streamDigest(bucket, key);
  if (digest !== sha256) {
    throw new ApiError(
      422,
      'RELEASE_SHA256_MISMATCH',
      `The object at ${key} hashes to ${digest}, not ${sha256}`,
    );
  }
  return { etag: head.etag, size: head.size, sha256: digest };
}

async function streamDigest(bucket: R2Bucket, key: string): Promise<string> {
  const object = await bucket.get(key);
  if (!object) {
    throw new ApiError(422, 'RELEASE_OBJECT_MISSING', `No object at ${key} in the release bucket`);
  }
  // `crypto.DigestStream` is a Workers runtime extension that the WebWorker
  // `Crypto` lib this project compiles against does not know about, so the
  // constructor is reached through one narrow cast rather than by widening the
  // whole `lib` and inheriting every other experimental global with it.
  const digestStream = (crypto as unknown as {
    DigestStream: new (algorithm: string) => WritableStream<ArrayBuffer | ArrayBufferView> & {
      readonly digest: Promise<ArrayBuffer>;
    };
  }).DigestStream;
  const stream = new digestStream('SHA-256');
  await object.body.pipeTo(stream);
  return hex(await stream.digest);
}
