import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const testSecrets = {
  JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
  ADMIN_API_TOKEN: 'admin-test-token-with-at-least-32-characters',
  HOME_AGENT_TOKEN: 'home-test-token-with-at-least-32-characters',
  TAILSCALE_OAUTH_CLIENT_ID: 'test',
  TAILSCALE_OAUTH_CLIENT_SECRET: 'tailscale-test-secret-with-at-least-32-characters',
  RESEND_API_KEY: 're_test-key-with-at-least-32-characters',
  CATALOG_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY',
};
Object.assign(process.env, testSecrets);

const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          ...testSecrets,
          EMAIL_FROM: 'login@example.com',
          APPLE_CLIENT_ID: 'com.raydocs.tono',
          GOOGLE_CLIENT_ID: 'test-google-client.apps.googleusercontent.com',
          DIRECT_SIGNUP_ALLOWLIST: '@example.com',
          TAILSCALE_ENROLLMENT_ENABLED: 'true',
          // Public half of a keypair generated for these tests only, so the
          // signature path is exercised against real Ed25519 rather than a stub.
          // The private half lives in worker-traffic-policy.test.ts; neither is the production
          // key, which exists only in the operator's keychain.
          TRAFFIC_POLICY_PUBLIC_KEY: '1ZcCKTp4auuTmkJfICPgVTOQDLhnM5We3v63lob0KO4=',
          TEST_MIGRATIONS: migrations,
          // Low thresholds so rate-limit tests finish quickly
          RATE_LIMIT_WINDOW_SECONDS: '900',
          RATE_LIMIT_EMAIL_START_IP: '50',
          RATE_LIMIT_EMAIL_START_EMAIL: '20',
          RATE_LIMIT_EMAIL_VERIFY_IP: '30',
          RATE_LIMIT_EMAIL_VERIFY_CHALLENGE: '3',
          RATE_LIMIT_OIDC_START_IP: '30',
          RATE_LIMIT_OIDC_START_INSTALLATION: '10',
          RATE_LIMIT_OIDC_VERIFY_IP: '30',
          RATE_LIMIT_OIDC_VERIFY_CHALLENGE: '3',
        },
        d1Databases: { DB: 'test-db' },
        // Local in-memory R2 for the raw-log pipeline and release downloads,
        // so upload and download verification are exercised against a real bucket API.
        r2Buckets: ['DIAGNOSTICS_LOGS', 'RELEASES'],
      },
    }),
  ],
  test: {
    maxWorkers: 1,
    setupFiles: ['./test/setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cjs/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],
    coverage: {
      // Off unless `vitest run --coverage` (npm test). The ops-contract job
      // runs one file through the same config; a floor there fails on files
      // that single file never executes.
      provider: 'istanbul',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'src/auth.ts',
        'src/sessions.ts',
        'src/ops/quota.ts',
        'src/ops/ledger.ts',
      ],
      thresholds: {
        // Measured on the full suite: auth 93.93/87.8, sessions 96.42/87.09,
        // ledger 97.26/81.68, quota 87.72/78.21 lines/branches. The floor sits
        // about five points under the lowest file so one missed branch does
        // not flap, and a real drop does.
        perFile: true,
        lines: 82,
        branches: 73,
        functions: 81,
        statements: 77,
      },
    },
  },
});
