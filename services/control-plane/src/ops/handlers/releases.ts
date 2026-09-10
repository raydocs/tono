import { body, rejectUnexpectedKeys } from '../../request';
import {
  ADOPTION_BUCKETS,
  PLATFORMS,
  assertAdoptionMatrix,
  assertRelease,
  assertUpdateChannel,
  type AdoptionBucket,
  type AdoptionMatrixDto,
  type Platform,
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
import {
  Actor,
  Env,
  auditWrite,
  check,
  decodeName,
  entityJson,
  jsonNoStore,
  listJson,
  now,
  parseRange,
  rangeSeconds,
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
    verifiedAt: null,
    signed: false,
    downloadUrl: row.r2Key ? `${DOWNLOAD_BASE}${row.r2Key}` : null,
    minOsVersion: null,
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

export async function postRelease(req: Request, e: Env, actor: Actor): Promise<Response> {
  const b = await body(req, 16 * 1024);
  rejectUnexpectedKeys(b, [
    'platform', 'channel', 'version', 'build', 'r2Key', 'sizeBytes', 'sha256',
    'notes', 'minSupportedVersion', 'publishedAt',
  ]);
  const created = await createRelease(e.DB, {
    platform: String(b.platform),
    channel: String(b.channel),
    version: String(b.version),
    build: b.build as string | null | undefined,
    r2Key: b.r2Key as string | null | undefined,
    sizeBytes: b.sizeBytes as number | null | undefined,
    sha256: b.sha256 as string | null | undefined,
    notes: b.notes as string | null | undefined,
    minSupportedVersion: b.minSupportedVersion as string | null | undefined,
    publishedAt: b.publishedAt as number | null | undefined,
  }, now());
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
  }, now());
  await auditWrite(e, actor.email, 'release.update', 'release', idValue, `updated ${updated.version}`);
  const dto = releaseDto(updated);
  check(e, () => { assertRelease(dto); });
  return jsonNoStore(dto);
}

export async function getReleaseAdoption(req: Request, e: Env): Promise<Response> {
  const range = parseRange(new URL(req.url).searchParams.get('range'));
  const days = Math.max(1, Math.round(rangeSeconds(range) / 86_400));
  const matrix = await adoptionMatrix(e.DB, { days, nowSec: now() });
  const cells = new Map<string, { platform: Platform; bucket: AdoptionBucket; users: number; devices: number }>();
  const released: Platform[] = [];
  for (const platform of PLATFORMS) {
    if (!matrix.unreleased[platform]) released.push(platform);
    for (const bucket of ADOPTION_BUCKETS) {
      cells.set(`${platform}:${bucket}`, { platform, bucket, users: 0, devices: 0 });
    }
  }
  for (const day of matrix.days) {
    for (const version of day.versions) {
      const bucket = version.bucket;
      const key = `${day.platform}:${bucket}`;
      const cell = cells.get(key);
      if (!cell) continue;
      cell.users += version.users;
      cell.devices += version.devices;
    }
  }
  const dto: AdoptionMatrixDto = {
    range,
    released,
    cells: [...cells.values()],
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
