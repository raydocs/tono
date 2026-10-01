import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CLIENT_UUID_PLACEHOLDER, managedCatalogYAML } from '../src/catalog-yaml';
import { ApiError } from '../src/errors';
import { canonicalTrafficPolicy } from '../src/traffic-policy';

const placeholderCatalog = [
  'proxies:',
  '  - name: Tokyo',
  '    type: vless',
  '    server: 203.0.113.60',
  '    port: 443',
  `    uuid: ${CLIENT_UUID_PLACEHOLDER}`,
  '',
].join('\n');

const bounded = fc.oneof(
  fc.string({ maxLength: 180 }),
  fc.integer(),
  fc.constant(null),
  fc.constant(undefined),
  fc.array(fc.string({ maxLength: 24 }), { maxLength: 4 }),
  fc.record({
    version: fc.constantFrom(0, 1, 2, 3, 4, 9),
    domains: fc.constant([]),
    mediaEndpoints: fc.constant([]),
  }),
);

describe('catalog and traffic-policy parsers', () => {
  it('keeps the placeholder identity on an accepted catalog and rejects garbage as ApiError', () => {
    expect(managedCatalogYAML(placeholderCatalog)).toContain(CLIENT_UUID_PLACEHOLDER);
    fc.assert(fc.property(bounded, (value) => {
      try {
        const yaml = managedCatalogYAML(value);
        expect(yaml).toContain(CLIENT_UUID_PLACEHOLDER);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
      }
    }), { numRuns: 40 });
  });

  it('does not let an unsigned policy grow private media or tcp endpoints', () => {
    const empty = canonicalTrafficPolicy({ version: 1, domains: [], mediaEndpoints: [] });
    expect(empty.mediaEndpoints).toEqual([]);
    expect(empty.tcpEndpoints ?? []).toEqual([]);
    expect(() => canonicalTrafficPolicy({
      version: 1,
      domains: [],
      mediaEndpoints: [{ address: '8.8.8.8', ports: [443] }],
    })).toThrow(ApiError);
    fc.assert(fc.property(bounded, (value) => {
      try {
        const policy = canonicalTrafficPolicy(value, false);
        expect(policy.mediaEndpoints).toEqual([]);
        expect(policy.tcpEndpoints ?? []).toEqual([]);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
      }
    }), { numRuns: 40 });
  });
});
