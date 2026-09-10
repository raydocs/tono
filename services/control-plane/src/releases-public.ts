// The two feeds every installed client polls, rendered from `client_releases`.
//
// Until now these were files on disk: a release was published by a GitHub
// workflow writing `public/appcast.xml`, and the row an operator saw in the
// console was a separate catalogue that agreed with the feed only by habit.
// This module makes the row the source — a build is on the feed because it is
// published, verified and not withdrawn, and 撤回 in the console is a client
// that stops being offered the update rather than a note to whoever runs the
// workflow next.
//
// The static files stay as the floor. When no row qualifies (an empty table, a
// database that has not been migrated, everything withdrawn) the asset is
// served exactly as before, byte for byte, because an updater that gets a 500
// from its feed is an updater that stops updating.

import type { Env } from './env';

/** Where a published build is fetched from. Mirrors the `/download/` route. */
const DOWNLOAD_BASE = 'https://releases.afk.ccwu.cc/download/';

/**
 * Sparkle refuses an item whose hardware requirements the machine does not
 * meet, and every macOS build Tono has ever shipped is Apple-silicon only —
 * the app is not built for x86_64 at all. Hard-coding it here matches what
 * `tooling/scripts/publish-macos-appcast.mjs` writes into the static feed; a
 * column for it would be a column with one value in every row.
 */
const MACOS_HARDWARE = 'arm64';

// Release-host aliases rewrite to the same static asset path. Include an
// explicit revision in the inner asset request so a previously cached alias
// cannot keep serving an older Sparkle feed after an asset-only deployment.
const RELEASE_ASSET_REVISION = 'site-public-pages-20260819';

/** Everything the release host serves out of `public/`, by request path. */
const ASSET_PATHS = new Map([
  ['/', '/releases/'],
  ['/index.html', '/releases/'],
  ['/releases', '/releases/'],
  ['/releases/', '/releases/'],
  ['/style.css', '/releases/style.css'],
  ['/manifest.json', '/releases/manifest.json'],
  ['/appcast.xml', '/appcast.xml'],
  ['/macos/appcast.xml', '/appcast.xml'],
  // Windows updaters used to ask raw.githubusercontent.com, which is
  // blocked in mainland China — so the customers most in need of a fix
  // were the ones who could not be told one existed, unless they were
  // already connected through the product being fixed.
  ['/windows/latest.json', '/windows/latest.json'],
  ['/favicon.svg', '/releases/favicon.svg'],
  ['/favicon.ico', '/releases/favicon.svg'],
  ['/robots.txt', '/releases/robots.txt'],
  ['/sitemap.xml', '/releases/sitemap.xml'],
  ['/.well-known/security.txt', '/releases/security.txt'],
  ['/help', '/releases/help.html'],
  ['/help/', '/releases/help.html'],
  ['/status', '/releases/status.html'],
  ['/status/', '/releases/status.html'],
  ['/archive', '/releases/archive.html'],
  ['/archive/', '/releases/archive.html'],
]);

/**
 * The three paths this module renders. `/macos/appcast.xml` is the alias the
 * shipped macOS builds ask for — their `SUFeedURL` points at the API host, not
 * at the release host — so both aliases have to answer, on both hosts, with the
 * same bytes. Two feeds that disagree is one client population that never
 * updates and nobody noticing.
 */
const FEED_PLATFORM = new Map<string, 'macos' | 'windows'>([
  ['/appcast.xml', 'macos'],
  ['/macos/appcast.xml', 'macos'],
  ['/windows/latest.json', 'windows'],
]);

type FeedRow = {
  id: string;
  version: string;
  build: string | null;
  r2_key: string | null;
  size_bytes: number | null;
  signature: string | null;
  min_os_version: string | null;
  notes: string | null;
  published_at: number;
  updated_at: number;
};

/**
 * A feed, from the catalogue when the catalogue has something to say and from
 * the static asset when it does not. Returns null for every path that is not
 * one of the three, so a caller on either host can use the call as the guard.
 */
export async function releasePublicRoute(
  req: Request,
  e: Env,
  path: string,
): Promise<Response | null> {
  const platform = FEED_PLATFORM.get(path);
  if (!platform) return null;
  const rows = await feedRows(e, platform);
  if (rows.length === 0) return assetResponse(req, e, ASSET_PATHS.get(path) as string);
  const body = platform === 'macos' ? appcastXml(rows) : windowsChannelJson(rows[0]);
  const type = platform === 'macos'
    ? 'application/rss+xml; charset=utf-8'
    : 'application/json; charset=utf-8';
  return feedResponse(req, body, type, etagFor(rows));
}

/** The rest of the release host's static site, unchanged. Null = 404. */
export async function releaseHostAsset(
  req: Request,
  e: Env,
  path: string,
): Promise<Response | null> {
  const assetPath = ASSET_PATHS.get(path);
  return assetPath ? assetResponse(req, e, assetPath) : null;
}

function assetResponse(req: Request, e: Env, assetPath: string): Promise<Response> {
  const assetURL = new URL(req.url);
  assetURL.pathname = assetPath;
  assetURL.searchParams.set('tono-release-revision', RELEASE_ASSET_REVISION);
  return e.ASSETS.fetch(new Request(assetURL, req));
}

/**
 * Published, verified, not withdrawn, stable — newest first.
 *
 * Sparkle picks its own item out of the list, so macOS gets every qualifying
 * row and the updater decides which one the machine can run; the Tauri channel
 * is a single build, so Windows uses the first. A row missing the object key or
 * the signature is dropped rather than rendered half-formed: a feed entry
 * without an enclosure is an update that fails on the client, silently.
 */
async function feedRows(e: Env, platform: 'macos' | 'windows'): Promise<FeedRow[]> {
  let rows: FeedRow[] = [];
  try {
    const result = await e.DB.prepare(
      `SELECT id, version, build, r2_key, size_bytes, signature, min_os_version,
              notes, published_at, updated_at
       FROM client_releases
       WHERE platform = ? AND channel = 'stable'
         AND published_at IS NOT NULL AND yanked_at IS NULL
         AND verified_at IS NOT NULL
       ORDER BY published_at DESC`,
    ).bind(platform).all<FeedRow>();
    rows = result.results ?? [];
  } catch (error) {
    if (!String(error).includes('no such table')) throw error;
    return [];
  }
  return rows.filter((row) => row.r2_key !== null && row.size_bytes !== null && row.signature !== null);
}

function feedResponse(req: Request, body: string, type: string, etag: string): Response {
  const headers = new Headers({
    'content-type': type,
    // The feed changes the moment a build is published or withdrawn, so it may
    // not be held; the etag is what keeps revalidation to a 304 rather than a
    // re-download for every client on every poll.
    'cache-control': 'no-cache',
    etag,
  });
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(req.method === 'HEAD' ? null : body, { headers });
}

function etagFor(rows: readonly FeedRow[]): string {
  let hash = 2166136261;
  for (const row of rows) {
    for (const char of `${row.id}:${row.updated_at};`) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    }
  }
  return `W/"${(hash >>> 0).toString(36)}-${rows.length}"`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** RFC 2822 in UTC, which is what Sparkle parses out of `pubDate`. */
function rfc2822(seconds: number): string {
  const at = new Date(seconds * 1000);
  return `${DAYS[at.getUTCDay()]}, ${pad(at.getUTCDate())} ${MONTHS[at.getUTCMonth()]} `
    + `${at.getUTCFullYear()} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:`
    + `${pad(at.getUTCSeconds())} +0000`;
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;');
}

/**
 * Release notes are markdown, and the static feed has always shipped them as
 * markdown inside CDATA — Sparkle renders `sparkle:format="markdown"` itself.
 * The only thing that has to be escaped is the CDATA terminator, which is split
 * across two sections rather than mangled.
 */
function cdata(value: string): string {
  return `<![CDATA[${value.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
}

function appcastItem(row: FeedRow): string {
  const lines = [
    '        <item>',
    `            <title>${escapeText(row.version)}</title>`,
    `            <pubDate>${rfc2822(row.published_at)}</pubDate>`,
    `            <sparkle:version>${escapeText(row.build ?? row.version)}</sparkle:version>`,
    `            <sparkle:shortVersionString>${escapeText(row.version)}</sparkle:shortVersionString>`,
  ];
  if (row.min_os_version !== null) {
    lines.push(
      `            <sparkle:minimumSystemVersion>${escapeText(row.min_os_version)}</sparkle:minimumSystemVersion>`,
    );
  }
  lines.push(`            <sparkle:hardwareRequirements>${MACOS_HARDWARE}</sparkle:hardwareRequirements>`);
  if (row.notes !== null) {
    lines.push(`            <description sparkle:format="markdown">${cdata(row.notes)}</description>`);
  }
  lines.push(
    `            <enclosure url="${escapeAttribute(`${DOWNLOAD_BASE}${row.r2_key}`)}"`
    + ` length="${row.size_bytes}" type="application/octet-stream"`
    + ` sparkle:edSignature="${escapeAttribute(row.signature as string)}"/>`,
    '        </item>',
  );
  return lines.join('\n');
}

function appcastXml(rows: readonly FeedRow[]): string {
  return [
    '<?xml version="1.0" standalone="yes"?>',
    '<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">',
    '    <channel>',
    '        <title>Tono</title>',
    ...rows.map(appcastItem),
    '    </channel>',
    '</rss>',
    '',
  ].join('\n');
}

/**
 * The Tauri updater's `latest.json`. Both platform keys carry the same build:
 * `windows-x86_64` is what older clients ask for and `windows-x86_64-nsis` what
 * the current bundle asks for, and they have always been the same installer.
 */
function windowsChannelJson(row: FeedRow): string {
  const update = {
    signature: row.signature as string,
    url: `${DOWNLOAD_BASE}${row.r2_key}`,
  };
  return `${JSON.stringify({
    version: row.version,
    notes: row.notes ?? '',
    pub_date: new Date(row.published_at * 1000).toISOString(),
    platforms: {
      'windows-x86_64': update,
      'windows-x86_64-nsis': update,
    },
  }, null, 2)}\n`;
}
