import { defineConfig } from 'vitest/config';

// React component tests that need a DOM (`@testing-library/react` `render`,
// `fireEvent`, `beforeunload` listeners, portals). The main vitest.config.ts
// runs in the Cloudflare Workers pool, which has no DOM; these admin component
// tests run under jsdom instead, without the Workers pool / D1 setup.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['admin/src/**/*.test.tsx'],
    // jsdom provides globals; no Workers D1 setup needed here.
    setupFiles: [],
  },
});
