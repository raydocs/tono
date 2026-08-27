export const PREVIEW_API_WORKER_NAME = 'tono-control-plane-ops-preview';
export const PREVIEW_ADMIN_WORKER_NAME = 'tono-admin-ops-preview';
export const PREVIEW_API_CONFIG_FILE = 'wrangler.preview.generated.jsonc';
export const PREVIEW_ADMIN_CONFIG_FILE = 'wrangler.preview.admin.generated.jsonc';

const productionHostnames = new Set([
  'admin.afk.ccwu.cc',
  'api.afk.ccwu.cc',
  'ops.afk.ccwu.cc',
  'quality.afk.ccwu.cc',
  'releases.afk.ccwu.cc',
]);
const productionDomainSuffixes = ['afk.ccwu.cc'];
const dedicatedPreviewHostname = /^ops-preview-[a-f0-9]{8,40}\.afk\.ccwu\.cc$/;

const apiTemplate = {
  $schema: 'node_modules/wrangler/config-schema.json',
  name: PREVIEW_API_WORKER_NAME,
  main: 'src/index.ts',
  compatibility_date: '2025-09-02',
  // The API has no public route in preview. Only the preview admin Worker may
  // call it through its explicit service binding.
  workers_dev: false,
  assets: { directory: './public', binding: 'ASSETS', run_worker_first: true },
  secrets: {
    required: [
      'JWT_SECRET',
      'ADMIN_API_TOKEN',
      'HOME_AGENT_TOKEN',
      'CATALOG_ENCRYPTION_KEY',
      'ACCESS_TEAM_DOMAIN',
      'ACCESS_AUD',
      'ACCESS_ADMIN_EMAILS',
    ],
  },
  d1_databases: [{
    binding: 'DB',
    database_name: 'tono-control-plane-ops-preview',
    database_id: '__TONO_PREVIEW_D1_DATABASE_ID__',
    migrations_dir: 'migrations',
  }],
  // Both buckets start empty and are preview-only. The Worker requires both
  // bindings, so omitting one would turn an accidental feature path into an
  // undefined binding rather than proving isolation.
  r2_buckets: [{
    binding: 'DIAGNOSTICS_LOGS',
    bucket_name: '__TONO_PREVIEW_DIAGNOSTICS_BUCKET__',
  }, {
    binding: 'RELEASES',
    bucket_name: '__TONO_PREVIEW_RELEASES_BUCKET__',
  }],
  vars: {
    ALLOWED_ORIGIN: 'https://__TONO_PREVIEW_ADMIN_HOSTNAME__',
    // Preview must not contact the production tailnet, issue enrollment keys,
    // send mail, or expose real OAuth client configuration.
    TAILSCALE_ENROLLMENT_ENABLED: 'false',
    EMAIL_FROM: 'Tono Ops Preview <no-reply@example.test>',
    APPLE_CLIENT_ID: '',
    GOOGLE_CLIENT_ID: '',
    DIRECT_SIGNUP_ALLOWLIST: '',
    ACCESS_TOKEN_TTL_SECONDS: '900',
    REFRESH_TOKEN_TTL_SECONDS: '2592000',
    PENDING_DEVICE_TTL_SECONDS: '1800',
    DIAGNOSTICS_RETENTION_SECONDS: '86400',
    DIAGNOSTICS_LOG_RETENTION_SECONDS: '86400',
  },
};

const adminTemplate = {
  $schema: 'node_modules/wrangler/config-schema.json',
  name: PREVIEW_ADMIN_WORKER_NAME,
  main: 'src/admin-worker.ts',
  compatibility_date: '2025-09-02',
  workers_dev: false,
  // This is a new, approval-gated hostname. It is never one of the existing
  // production domains, and is the only public preview surface.
  routes: [{
    pattern: '__TONO_PREVIEW_ADMIN_HOSTNAME__',
    custom_domain: true,
  }],
  assets: { directory: './public', binding: 'ASSETS', run_worker_first: true },
  services: [{
    binding: 'API',
    service: PREVIEW_API_WORKER_NAME,
  }],
  secrets: {
    required: [
      'ACCESS_TEAM_DOMAIN',
      'ACCESS_AUD',
      'ACCESS_ADMIN_EMAILS',
    ],
  },
  d1_databases: [{
    binding: 'DB',
    database_name: 'tono-control-plane-ops-preview',
    database_id: '__TONO_PREVIEW_D1_DATABASE_ID__',
  }],
  vars: {
    ALLOWED_ORIGIN: 'https://__TONO_PREVIEW_ADMIN_HOSTNAME__',
  },
};

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function requiredText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function previewHostname(value) {
  const hostname = requiredText(value, 'PREVIEW_ADMIN_HOSTNAME').toLowerCase();
  if (
    hostname.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname) ||
    productionHostnames.has(hostname) ||
    (productionDomainSuffixes.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) &&
      !dedicatedPreviewHostname.test(hostname))
  ) {
    throw new Error('PREVIEW_ADMIN_HOSTNAME must be a new non-production hostname');
  }
  return hostname;
}

function previewDatabaseId(value) {
  const id = requiredText(value, 'PREVIEW_D1_DATABASE_ID').toLowerCase();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id)) {
    throw new Error('PREVIEW_D1_DATABASE_ID must be a non-placeholder D1 UUID');
  }
  return id;
}

function previewBucket(value, variable) {
  const bucket = requiredText(value, variable).toLowerCase();
  if (!/^tono-ops-preview-[a-z0-9-]{1,42}$/.test(bucket)) {
    throw new Error(`${variable} must use the tono-ops-preview- namespace`);
  }
  return bucket;
}

function replacePlaceholders(value, replacements) {
  if (Array.isArray(value)) return value.map((item) => replacePlaceholders(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePlaceholders(item, replacements)]));
  }
  if (typeof value !== 'string') return value;
  return Object.entries(replacements).reduce(
    (result, [placeholder, replacement]) => result.replaceAll(placeholder, replacement),
    value,
  );
}

function assertNoPlaceholders(value) {
  const unresolved = JSON.stringify(value).match(/__[A-Z0-9_]+__/g);
  if (unresolved) throw new Error(`unresolved preview configuration placeholders: ${unresolved.join(', ')}`);
}

/**
 * Renders configuration only. It never invokes Wrangler or the Cloudflare API.
 * Resource IDs and the hostname are intentionally supplied through an ignored
 * local file after a human has approved their creation.
 */
export function renderPreviewConfigs(input) {
  const replacements = {
    __TONO_PREVIEW_D1_DATABASE_ID__: previewDatabaseId(input.d1DatabaseId),
    __TONO_PREVIEW_ADMIN_HOSTNAME__: previewHostname(input.adminHostname),
    __TONO_PREVIEW_DIAGNOSTICS_BUCKET__: previewBucket(input.diagnosticsBucket, 'PREVIEW_DIAGNOSTICS_BUCKET'),
    __TONO_PREVIEW_RELEASES_BUCKET__: previewBucket(input.releasesBucket, 'PREVIEW_RELEASES_BUCKET'),
  };
  const api = replacePlaceholders(copy(apiTemplate), replacements);
  const admin = replacePlaceholders(copy(adminTemplate), replacements);
  assertNoPlaceholders(api);
  assertNoPlaceholders(admin);
  return { api, admin };
}

/** Both Worker deploys must receive this exact lower-case, full Git SHA. */
export function previewDeploymentPlan(buildSha) {
  if (typeof buildSha !== 'string' || !/^[a-f0-9]{40}$/.test(buildSha)) {
    throw new Error('BUILD_SHA must be one lower-case 40-character Git SHA');
  }
  return {
    buildSha,
    api: { config: PREVIEW_API_CONFIG_FILE, buildSha },
    admin: { config: PREVIEW_ADMIN_CONFIG_FILE, buildSha },
  };
}
