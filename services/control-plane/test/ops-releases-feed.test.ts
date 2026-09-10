import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index';
import { postRelease } from '../src/ops/handlers/releases';
import { createRelease, updateRelease } from '../src/ops/releases';
import staticAppcast from '../public/appcast.xml?raw';
import staticChannel from '../public/windows/latest.json?raw';

/**
 * The feeds every installed client polls, now rendered from `client_releases`.
 *
 * The two properties worth holding here are the ones a mistake hides behind:
 * the two macOS aliases must be byte-identical on both hosts (a client whose
 * `SUFeedURL` points at the API host and a client pointed at the release host
 * must see the same build), and a table with nothing publishable in it must
 * still serve the committed static file — an updater that gets a 500 from its
 * feed is an updater that quietly stops updating.
 */

const db = () => (env as unknown as { DB: D1Database }).DB;
const bucket = () => (env as unknown as { RELEASES: R2Bucket }).RELEASES;
const NOW = 1_800_000_000;
const API_HOST = 'https://api.afk.ccwu.cc';
const RELEASE_HOST = 'https://releases.afk.ccwu.cc';

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function pattern(length: number, step: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i * step + 7) % 256;
  return out;
}

const SPARKLE_SIGNATURE = base64(pattern(64, 7));
const MINISIGN_SIGNATURE = btoa([
  'untrusted comment: signature from tono test key',
  base64(pattern(74, 11)),
  'trusted comment: timestamp:1800000000\tfile:Tono_setup.exe',
  base64(pattern(64, 13)),
  '',
].join('\n'));

async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function seedRelease(input: {
  platform: 'macos' | 'windows' | 'linux';
  version: string;
  build?: string | null;
  notes?: string | null;
  minOsVersion?: string | null;
  publishedAt?: number | null;
  withdrawn?: boolean;
}) {
  const body = `${input.platform} ${input.version} bytes`;
  const key = `clients/${input.platform}/${input.version}.bin`;
  const sha256 = await sha256Hex(body);
  const bytes = new TextEncoder().encode(body);
  await bucket().put(key, bytes, { sha256 });
  const created = await createRelease(db(), bucket(), {
    platform: input.platform,
    channel: 'stable',
    version: input.version,
    build: input.build,
    notes: input.notes,
    minOsVersion: input.minOsVersion,
    signature: input.platform === 'windows' ? MINISIGN_SIGNATURE : SPARKLE_SIGNATURE,
    r2Key: key,
    sizeBytes: bytes.byteLength,
    sha256,
  }, NOW);
  if (input.publishedAt != null) {
    await updateRelease(db(), created.id, { publish: true }, input.publishedAt);
  }
  if (input.withdrawn) await updateRelease(db(), created.id, { yank: true }, NOW + 1);
  return created;
}

async function get(host: string, path: string, init: RequestInit = {}): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${host}${path}`, init),
    env as unknown as Env,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

beforeEach(async () => {
  await db().prepare('DELETE FROM client_releases').run();
});

describe('the Sparkle appcast', () => {
  it('renders one item per published, verified, non-withdrawn macOS build', async () => {
    await seedRelease({
      platform: 'macos', version: '1.9.0', build: '1900', minOsVersion: '26.3',
      notes: '# 1.9.0\n\nfixes & things <b>', publishedAt: NOW + 20,
    });
    await seedRelease({ platform: 'macos', version: '1.8.0', publishedAt: NOW + 10 });
    await seedRelease({ platform: 'macos', version: '1.7.0', publishedAt: NOW, withdrawn: true });
    await seedRelease({ platform: 'macos', version: '2.0.0' });

    const feed = await get(RELEASE_HOST, '/appcast.xml');
    expect(feed.status).toBe(200);
    expect(feed.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8');
    expect(feed.headers.get('cache-control')).toBe('no-cache');
    const xml = await feed.text();

    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml.indexOf('1.9.0')).toBeLessThan(xml.indexOf('1.8.0'));
    expect(xml).not.toContain('1.7.0');
    expect(xml).not.toContain('2.0.0');

    // The build is what Sparkle compares; the version is what it shows.
    expect(xml).toContain('<sparkle:version>1900</sparkle:version>');
    expect(xml).toContain('<sparkle:shortVersionString>1.9.0</sparkle:shortVersionString>');
    // A build with no recorded build number falls back to its version rather
    // than to an empty tag, which Sparkle reads as "older than everything".
    expect(xml).toContain('<sparkle:version>1.8.0</sparkle:version>');
    expect(xml).toContain('<sparkle:minimumSystemVersion>26.3</sparkle:minimumSystemVersion>');
    expect(xml.match(/minimumSystemVersion/g)).toHaveLength(2);
    expect(xml).toContain('<sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>');
    expect(xml).toContain('<![CDATA[# 1.9.0\n\nfixes & things <b>]]>');

    const bytes = new TextEncoder().encode('macos 1.9.0 bytes').byteLength;
    expect(xml).toContain(
      '<enclosure url="https://releases.afk.ccwu.cc/download/clients/macos/1.9.0.bin"'
      + ` length="${bytes}" type="application/octet-stream"`
      + ` sparkle:edSignature="${SPARKLE_SIGNATURE}"/>`,
    );
  });

  it('dates each item in the format Sparkle parses', async () => {
    await seedRelease({ platform: 'macos', version: '1.9.0', publishedAt: 1_800_000_020 });
    const xml = await (await get(RELEASE_HOST, '/appcast.xml')).text();
    expect(xml).toContain('<pubDate>Fri, 15 Jan 2027 08:00:20 +0000</pubDate>');
  });

  it('serves the same bytes at both aliases on both hosts', async () => {
    await seedRelease({ platform: 'macos', version: '1.9.0', publishedAt: NOW + 20 });
    const bodies: string[] = [];
    for (const [host, path] of [
      [RELEASE_HOST, '/appcast.xml'],
      [RELEASE_HOST, '/macos/appcast.xml'],
      [API_HOST, '/appcast.xml'],
      [API_HOST, '/macos/appcast.xml'],
    ]) {
      const response = await get(host, path);
      expect(response.status, `${host}${path}`).toBe(200);
      bodies.push(await response.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('1.9.0');
  });

  it('answers a revalidation with 304 rather than the feed again', async () => {
    await seedRelease({ platform: 'macos', version: '1.9.0', publishedAt: NOW + 20 });
    const first = await get(RELEASE_HOST, '/appcast.xml');
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^W\//);
    const again = await get(RELEASE_HOST, '/appcast.xml', {
      headers: { 'if-none-match': etag as string },
    });
    expect(again.status).toBe(304);
  });
});

describe('the Tauri channel', () => {
  it('renders both Windows platform keys from the newest published build', async () => {
    await seedRelease({
      platform: 'windows', version: '2.0.0', notes: 'newer', publishedAt: 1_800_000_020,
    });
    await seedRelease({ platform: 'windows', version: '1.9.0', publishedAt: NOW + 10 });

    const response = await get(RELEASE_HOST, '/windows/latest.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const channel = await response.json() as {
      version: string;
      notes: string;
      pub_date: string;
      platforms: Record<string, { signature: string; url: string }>;
    };
    expect(channel.version).toBe('2.0.0');
    expect(channel.notes).toBe('newer');
    expect(channel.pub_date).toBe('2027-01-15T08:00:20.000Z');
    expect(Object.keys(channel.platforms)).toEqual(['windows-x86_64', 'windows-x86_64-nsis']);
    for (const update of Object.values(channel.platforms)) {
      expect(update.signature).toBe(MINISIGN_SIGNATURE);
      expect(update.url).toBe('https://releases.afk.ccwu.cc/download/clients/windows/2.0.0.bin');
    }
  });

  it('drops back to the newest still-published build when one is withdrawn', async () => {
    const newest = await seedRelease({ platform: 'windows', version: '2.0.0', publishedAt: NOW + 20 });
    await seedRelease({ platform: 'windows', version: '1.9.0', publishedAt: NOW + 10 });
    await updateRelease(db(), newest.id, { yank: true }, NOW + 30);

    const channel = await (await get(RELEASE_HOST, '/windows/latest.json')).json() as { version: string };
    expect(channel.version).toBe('1.9.0');
  });
});

describe('with nothing publishable in the catalogue', () => {
  it('serves the committed static feeds, byte for byte', async () => {
    // Registered, never published: it may not reach a client either way.
    await seedRelease({ platform: 'macos', version: '1.9.0' });

    for (const host of [RELEASE_HOST, API_HOST]) {
      for (const path of ['/appcast.xml', '/macos/appcast.xml']) {
        const response = await get(host, path);
        expect(response.status, `${host}${path}`).toBe(200);
        expect(await response.text(), `${host}${path}`).toBe(staticAppcast);
      }
      const channel = await get(host, '/windows/latest.json');
      expect(channel.status).toBe(200);
      expect(await channel.text()).toBe(staticChannel);
    }
  });
});

describe('POST releases', () => {
  const actor = { email: 'operator@example.com' };

  it('refuses to be handed a publication date', async () => {
    const request = new Request(`${API_HOST}/api/v1/ops/releases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'macos', channel: 'stable', version: '1.9.0',
        r2Key: 'clients/macos/1.9.0.bin', sizeBytes: 17, sha256: 'a'.repeat(64),
        signature: SPARKLE_SIGNATURE, publishedAt: NOW,
      }),
    });
    await expect(postRelease(request, env as unknown as Env, actor))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('registers a build and hands back what was checked', async () => {
    const body = 'macos 1.9.0 bytes';
    const sha256 = await sha256Hex(body);
    await bucket().put('clients/macos/1.9.0.bin', new TextEncoder().encode(body), { sha256 });
    const request = new Request(`${API_HOST}/api/v1/ops/releases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'macos', channel: 'stable', version: '1.9.0',
        r2Key: 'clients/macos/1.9.0.bin', sizeBytes: body.length, sha256,
        signature: SPARKLE_SIGNATURE, minOsVersion: '26.3',
      }),
    });
    const response = await postRelease(request, env as unknown as Env, actor);
    expect(response.status).toBe(201);
    const dto = await response.json() as {
      verifiedAt: number | null;
      signed: boolean;
      minOsVersion: string | null;
      downloadUrl: string | null;
    };
    expect(dto.verifiedAt).not.toBeNull();
    expect(dto.signed).toBe(true);
    expect(dto.minOsVersion).toBe('26.3');
    expect(dto.downloadUrl).toBe('https://releases.afk.ccwu.cc/download/clients/macos/1.9.0.bin');
  });
});
