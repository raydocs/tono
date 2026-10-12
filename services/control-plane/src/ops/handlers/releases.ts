import { body, rejectUnexpectedKeys } from '../../request';
import {
  assertAdoptionMatrix,
  assertRelease,
  assertReleaseObjectList,
  assertUpdateChannel,
  type AdoptionMatrixDto,
  type ReleaseObjectListDto,
  type ReleaseDto,
} from '../contract';
import {
  adoptionMatrix,
  createRelease,
  listReleases,
  updateRelease,
  type ClientRelease,
} from '../releases';
import { listUpdateChannels } from '../releases-channels';
import { listReleaseObjects } from '../releases-objects';
import { ApiError } from '../../errors';
import { listEnvelope } from '../http';
import {
  Actor,
  Env,
  auditWrite,
  check,
  decodeName,
  entityJson,
  jsonNoStore,
  jsonWithEtag,
  notModified,
  listJson,
  now,
  parseLimit,
  parseRange,
  weakEtag,
} from './common';

/** Where a published build is fetched from; D3 puts the object behind it. */
const DOWNLOAD_BASE = 'https://releases.afk.ccwu.cc/download/';

function releaseDto(row: ClientRelease): ReleaseDto {
  return {
    id: row.id,
    platform: row.platform,
    channel: row.channel,
    version: row.version,
    build: row.build,
    r2Key: row.r2Key,
    sha256: row.sha256,
    notes: row.notes,
    minSupportedVersion: row.minSupportedVersion,
    publishedAt: row.publishedAt,
    withdrawnAt: row.yankedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sizeBytes: row.sizeBytes ?? null,
    verifiedAt: row.verifiedAt,
    signed: row.signature !== null,
    downloadUrl: row.r2Key ? `${DOWNLOAD_BASE}${row.r2Key}` : null,
    minOsVersion: row.minOsVersion,
  };
}

export async function getReleases(req: Request, e: Env): Promise<Response> {
  const url = new URL(req.url);
  const platform = url.searchParams.get('platform') ?? undefined;
  const channel = url.searchParams.get('channel') ?? undefined;
  const rows = await listReleases(e.DB, { platform, channel });
  const items = rows.map(releaseDto);
  const updatedAt = items.reduce((max, row) => Math.max(max, row.updatedAt), now());
  return listJson(
    e, req, items, null, updatedAt,
    weakEtag([updatedAt, items.length, platform ?? null, channel ?? null]),
    assertRelease, items.length,
  );
}

const REQUIRED_RELEASE_FIELDS = ['platform', 'channel', 'version', 'r2Key', 'sizeBytes', 'sha256'] as const;

export async function postRelease(req: Request, e: Env, actor: Actor): Promise<Response> {
  const b = await body(req, 16 * 1024);
  rejectUnexpectedKeys(b, [
    'platform', 'channel', 'version', 'build', 'r2Key', 'sizeBytes', 'sha256',
    'signature', 'minOsVersion', 'notes', 'minSupportedVersion', 'publishedAt',
  ]);
  // `String(undefined)` is "undefined": a missing field must be a 400, not a
  // release called "undefined". These six are what makes a row verifiable.
  for (const name of REQUIRED_RELEASE_FIELDS) {
    if (b[name] === undefined || b[name] === null || b[name] === '') {
      throw new ApiError(400, 'VALIDATION_ERROR', `Missing ${name}`);
    }
  }
  const created = await createRelease(e.DB, {
    platform: b.platform as string,
    channel: b.channel as string,
    version: b.version as string,
    build: b.build as string | null | undefined,
    r2Key: b.r2Key as string | null | undefined,
    sizeBytes: b.sizeBytes as number | null | undefined,
    sha256: b.sha256 as string | null | undefined,
    signature: b.signature as string | null | undefined,
    minOsVersion: b.minOsVersion as string | null | undefined,
    notes: b.notes as string | null | undefined,
    minSupportedVersion: b.minSupportedVersion as string | null | undefined,
    publishedAt: b.publishedAt as number | null | undefined,
  }, now(), e.RELEASES);
  await auditWrite(e, actor.email, 'release.create', 'release', created.id, `${created.platform} ${created.version}`);
  const dto = releaseDto(created);
  check(e, () => { assertRelease(dto); });
  return jsonNoStore(dto, 201);
}

export async function patchRelease(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  const idValue = decodeName(rawId, 'id');
  const b = await body(req, 16 * 1024);
  rejectUnexpectedKeys(b, ['notes', 'minSupportedVersion', 'publish', 'yank', 'yankReason', 'withdraw']);
  const updated = await updateRelease(e.DB, idValue, {
    notes: b.notes as string | null | undefined,
    minSupportedVersion: b.minSupportedVersion as string | null | undefined,
    publish: b.publish === true,
    yank: b.yank === true || b.withdraw === true,
    yankReason: (b.yankReason as string | null | undefined),
  }, now(), e.RELEASES);
  await auditWrite(e, actor.email, 'release.update', 'release', idValue, `updated ${updated.version}`);
  const dto = releaseDto(updated);
  check(e, () => { assertRelease(dto); });
  return jsonNoStore(dto);
}

export async function getReleaseAdoption(req: Request, e: Env): Promise<Response> {
  const range = parseRange(new URL(req.url).searchParams.get('range'));
  // One cell per platform × bucket, each device counted once at the last
  // version it reported inside the range. Summing the per-day rollup instead
  // reported a device seen on thirty days as thirty devices.
  const matrix = await adoptionMatrix(e.DB, { range, nowSec: now() });
  const dto: AdoptionMatrixDto = {
    range,
    released: matrix.released,
    cells: matrix.cells,
    updatedAt: now(),
  };
  return entityJson(e, req, dto, weakEtag([range, dto.updatedAt, dto.cells.length]), assertAdoptionMatrix);
}

/**
 * 更新源. Five rows, always — a platform with no updater is a row that says so,
 * not a row that is missing.
 */
export async function getReleaseChannels(req: Request, e: Env): Promise<Response> {
  const t = now();
  const items = await listUpdateChannels(e.DB, t);
  return listJson(
    e, req, items, null, t,
    weakEtag(items.map((row) => `${row.platform}:${row.current?.version ?? ''}`)),
    assertUpdateChannel, items.length,
  );
}

/**
 * The register-release picker: the newest objects in the release bucket, each with what
 * the key guesses and whether a row already points at it.
 */
export async function getReleaseObjects(req: Request, e: Env): Promise<Response> {
  const limit = parseLimit(new URL(req.url).searchParams.get('limit'), { default: 50, max: 200 });
  const { items, truncated } = await listReleaseObjects(e.RELEASES, e.DB, limit);
  const t = now();
  const etag = weakEtag([
    truncated ? 1 : 0,
    ...items.map((row) => `${row.key}:${row.etag}:${row.registered ? 1 : 0}`),
  ]);
  const hit = notModified(req, etag);
  if (hit) return hit;
  const dto: ReleaseObjectListDto = { ...listEnvelope(items, null, t, items.length), truncated };
  check(e, () => { assertReleaseObjectList(dto); });
  return jsonWithEtag(dto, etag);
}
