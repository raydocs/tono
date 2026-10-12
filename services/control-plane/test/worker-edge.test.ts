import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../src/crypto';
import worker, { parseBytesRange, type Env } from '../src/index';
import adminWorker from '../src/admin-worker';
import {
  api,
  json,
  admin,
  operations,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  it('sets defensive response headers and rejects an empty bearer token', async () => {
    const health = await api('health');
    expect(health.status).toBe(200);
    expect(health.headers.get('cache-control')).toBe('no-store');
    expect(health.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');

    const preflight = await api('health', {
      method: 'OPTIONS',
      headers: { origin: String((env as unknown as Env).ALLOWED_ORIGIN) },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('PUT');

    const empty = await api('admin/users', {
      headers: { authorization: 'Bearer ' },
    });
    expect(empty.status).toBe(401);
  });

  it('keeps non-operations routes unreachable on the dedicated admin worker', async () => {
    for (const path of ['/api/v1/health', '/api/v1/admin/users', '/api/v1/diagnostics/reports']) {
      const context = createExecutionContext();
      const response = await adminWorker.fetch(
        new Request(`https://admin.afk.ccwu.cc${path}`),
        env as unknown as Parameters<typeof adminWorker.fetch>[1],
        context,
      );
      await waitOnExecutionContext(context);
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('only reports API/admin builds aligned when both carry the same release SHA', async () => {
    const version = async (apiBuildSha: string | undefined, adminBuildSha: string | undefined) => {
      const context = createExecutionContext();
      const response = await adminWorker.fetch(
        new Request('https://admin.afk.ccwu.cc/api/v1/ops/system/version'),
        {
          API: {
            fetch: async () => Response.json({
              system: { service: 'api', version: '0.0.1', buildSha: apiBuildSha ?? 'development' },
            }),
          } as unknown as Fetcher,
          BUILD_SHA: adminBuildSha,
        } as unknown as Parameters<typeof adminWorker.fetch>[1],
        context,
      );
      await waitOnExecutionContext(context);
      return response.json() as Promise<{ system: { aligned: boolean } }>;
    };
    const same = 'a'.repeat(40);
    const other = 'b'.repeat(40);

    expect((await version(undefined, undefined)).system.aligned).toBe(false);
    expect((await version(same, undefined)).system.aligned).toBe(false);
    expect((await version(same, other)).system.aligned).toBe(false);
    expect((await version(same, same)).system.aligned).toBe(true);
  });

  it('serves an isolated release archive on the release subdomain', async () => {
    const fetchRelease = async (path: string, init: RequestInit = {}) => {
      const context = createExecutionContext();
      const response = await worker.fetch(
        new Request(`https://releases.afk.ccwu.cc${path}`, init),
        env as unknown as Env,
        context,
      );
      await waitOnExecutionContext(context);
      return response;
    };

    const page = await fetchRelease('/');
    expect(page.status).toBe(200);
    expect(page.headers.get('location')).toBeNull();
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(page.headers.get('content-security-policy')).toContain("img-src 'self' data:");
    expect(page.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
    expect(await page.text()).toContain('Tono 发布档案');

    const sitemap = await fetchRelease('/sitemap.xml');
    expect(sitemap.status).toBe(200);
    expect(await sitemap.text()).toContain('https://releases.afk.ccwu.cc/help');

    const robots = await fetchRelease('/robots.txt');
    expect(robots.status).toBe(200);
    expect(await robots.text()).toContain('Sitemap: https://releases.afk.ccwu.cc/sitemap.xml');

    const security = await fetchRelease('/.well-known/security.txt');
    expect(security.status).toBe(200);
    expect(await security.text()).toContain('Canonical: https://releases.afk.ccwu.cc/.well-known/security.txt');

    for (const path of ['/help', '/status', '/archive', '/favicon.svg']) {
      expect((await fetchRelease(path)).status).toBe(200);
    }

    const canonicalPage = await fetchRelease('/releases/');
    expect(canonicalPage.status).toBe(200);
    expect(await canonicalPage.text()).toContain('Tono 发布档案');

    const manifest = await fetchRelease('/manifest.json');
    expect(manifest.status).toBe(200);
    const manifestBody = (await manifest.json()) as {
      schemaVersion: number;
      channel: string;
      platforms: Record<
        string,
        { current: { version: string; artifact: { url: string; sha256: string; size: number } } }
      >;
      archive: Array<{ platform: string; version: string; publishedAt: string }>;
    };
    expect(manifestBody).toMatchObject({ schemaVersion: 1, channel: 'test' });

    // Pinned versions used to live here, which made this test a step in the
    // release checklist that nobody remembers — the same mistake the appcast
    // assertion below already avoids. What is worth catching is a manifest that
    // disagrees with itself, because it is edited by hand in two places: the
    // card a customer reads and the archive entry beneath it. So each platform's
    // current version must be its newest archive entry, and must be the version
    // whose file it actually offers.
    for (const platform of ['macos', 'windows']) {
      const current = manifestBody.platforms[platform].current;
      const newest = manifestBody.archive
        .filter((entry) => entry.platform === platform)
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];
      expect(newest).toBeDefined();
      expect(newest.version).toBe(current.version);
      expect(current.artifact.url).toContain(current.version);
      expect(current.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(current.artifact.size).toBeGreaterThan(0);
    }

    // Every Windows build from 0.0.33 asks this host for its update metadata,
    // because the address it used to ask — raw.githubusercontent.com — is
    // blocked in mainland China, so the updater could only find a release while
    // the tunnel it might be needed to fix was already carrying traffic. The
    // path is an explicit entry in the release host's allowlist, so forgetting
    // it 404s every updater at once; that is what this asserts.
    const channel = await fetchRelease('/windows/latest.json');
    expect(channel.status).toBe(200);
    const channelBody = (await channel.json()) as {
      version: string;
      platforms: Record<string, { url: string; signature: string }>;
    };
    expect(channelBody.version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const platform of Object.values(channelBody.platforms)) {
      expect(platform.url).toContain(channelBody.version);
      // An unsigned payload is one tauri-plugin-updater refuses, so serving one
      // would be an update nobody can install rather than a visible failure.
      expect(platform.signature.length).toBeGreaterThan(0);
    }

    // Asserted against the file this deploy would publish, not against a build
    // number. Pinning a number couples every release to this test, and it broke
    // the moment the feed was corrected — which is the wrong thing to notice
    // about a release: what matters here is that the subdomain serves the feed at
    // all, and serves the one on disk.
    const appcast = await fetchRelease('/macos/appcast.xml');
    expect(appcast.status).toBe(200);
    const servedFeed = await appcast.text();
    expect(servedFeed).toContain('<rss');
    expect(servedFeed).toContain('sparkle:version');
    // The alias must serve the same document as the canonical path. That is the
    // property worth holding: these two diverging is how a client updates from a
    // feed nobody thinks is live, and it is what the cache-busting fix was for.
    const canonicalFeed = await fetchRelease('/appcast.xml');
    expect(canonicalFeed.status).toBe(200);
    expect(await canonicalFeed.text()).toBe(servedFeed);

    expect((await fetchRelease('/api/v1/health')).status).toBe(404);
    const rejected = await fetchRelease('/manifest.json', { method: 'POST' });
    expect(rejected.status).toBe(405);
    expect(rejected.headers.get('allow')).toBe('GET, HEAD');

    await (env as unknown as Env).RELEASES.put('Tono_range.bin', 'abcdefghij');
    const ranged = await fetchRelease('/download/Tono_range.bin', {
      headers: { range: 'bytes=2-5' },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('accept-ranges')).toBe('bytes');
    expect(ranged.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await ranged.text()).toBe('cdef');
  });

  it('serves only exact desktop v1 objects without caching the discovery pointer', async () => {
    const bucket = (env as unknown as Env).RELEASES;
    const digest = 'ab'.repeat(32);
    const immutable = `/desktop/v1/${digest}`;
    const latest = '/desktop/v1/latest/manifest.json';
    const fetchRelease = async (path: string, init: RequestInit = {}, host = 'releases.afk.ccwu.cc') => {
      const context = createExecutionContext();
      const response = await worker.fetch(
        new Request(`https://${host}${path}`, init), env as unknown as Env, context,
      );
      await waitOnExecutionContext(context);
      return response;
    };

    const missing = await fetchRelease(latest);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    const original = '{"releaseId":"signed-bytes-must-not-be-reserialized"}';
    await bucket.put(latest.slice(1), original, {
      httpMetadata: { cacheControl: 'public, max-age=31536000, immutable' },
    });
    await bucket.put(`${immutable.slice(1)}/manifest.json`, original);
    const discovery = await fetchRelease(latest, { headers: { range: 'bytes=0-2' } });
    expect(discovery.status).toBe(200);
    expect(discovery.headers.get('cache-control')).toBe('no-store');
    expect(discovery.headers.get('accept-ranges')).toBe('none');
    expect(discovery.headers.get('content-type')).toBe('application/json');
    expect(discovery.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await discovery.text()).toBe(original);
    await bucket.put(latest.slice(1), '{"releaseId":"next"}');
    expect(await (await fetchRelease(latest)).text()).toBe('{"releaseId":"next"}');
    const retained = await fetchRelease(`${immutable}/manifest.json`);
    expect(retained.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await retained.text()).toBe(original);

    await bucket.put(`${immutable.slice(1)}/manifest.macos-arm64.sig`, 'mac-signature');
    await bucket.put(`${immutable.slice(1)}/manifest.windows-x86_64.sig`, 'windows-signature');
    expect(await (await fetchRelease(`${immutable}/manifest.macos-arm64.sig`)).text()).toBe('mac-signature');
    expect(await (await fetchRelease(`${immutable}/manifest.windows-x86_64.sig`)).text()).toBe('windows-signature');
    await bucket.put(`${immutable.slice(1)}/package.macos-arm64.zip`, 'mac-package');
    const head = await fetchRelease(`${immutable}/package.macos-arm64.zip`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('11');
    expect(head.headers.get('content-disposition')).toBe('attachment; filename="package.macos-arm64.zip"');
    expect(await head.text()).toBe('');
    await bucket.put(`${immutable.slice(1)}/package.windows-x86_64.exe`, 'abcdefghijk');
    const ranged = await fetchRelease(`${immutable}/package.windows-x86_64.exe`, {
      headers: { range: 'bytes=3-6' },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 3-6/11');
    expect(await ranged.text()).toBe('defg');

    // Invalid names remain inaccessible even when matching bucket keys exist.
    await bucket.put('desktop/v1/latest/package.windows-x86_64.exe', 'not-an-offer');
    await bucket.put(`${immutable.slice(1)}/private.json`, 'not-public');
    expect((await fetchRelease('/desktop/v1/latest/package.windows-x86_64.exe')).status).toBe(404);
    expect((await fetchRelease(`${immutable}/private.json`)).status).toBe(404);
    expect((await fetchRelease(`/desktop/v1/${digest.toUpperCase()}/manifest.json`)).status).toBe(404);
    expect((await fetchRelease(`${immutable}/manifest.json`, {}, 'test')).status).toBe(404);
    const write = await fetchRelease(latest, { method: 'PUT', body: 'replace' });
    expect(write.status).toBe(405);
    expect(write.headers.get('allow')).toBe('GET, HEAD');
    expect(await (await fetchRelease(latest)).text()).toBe('{"releaseId":"next"}');
  });

  it('parses a single byte range and rejects the rest', () => {
    expect(parseBytesRange('bytes=0-0', 10)).toEqual({ offset: 0, length: 1 });
    expect(parseBytesRange('bytes=2-5', 10)).toEqual({ offset: 2, length: 4 });
    expect(parseBytesRange('bytes=8-', 10)).toEqual({ offset: 8, length: 2 });
    expect(parseBytesRange('bytes=-3', 10)).toEqual({ offset: 7, length: 3 });
    expect(parseBytesRange('bytes=0-99', 10)).toEqual({ offset: 0, length: 10 });
    expect(parseBytesRange('bytes=10-12', 10)).toBeNull();
    expect(parseBytesRange('bytes=5-2', 10)).toBeNull();
    expect(parseBytesRange('bytes=0-1,2-3', 10)).toBeNull();
    expect(parseBytesRange(null, 10)).toBeNull();
  });
});
