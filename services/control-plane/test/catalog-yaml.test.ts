import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import { managedCatalogYAML, retirementCatalogPlan } from '../src/catalog-yaml';

function expectInvalidCatalog(yaml: string) {
  try {
    managedCatalogYAML(yaml);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).code).toBe('INVALID_CATALOG');
    return;
  }
  throw new Error('expected INVALID_CATALOG');
}

describe('catalog hy2 contract', () => {
  it('admits a same-node hy2 block, rejects one without fingerprint, and retires both with the base name', () => {
    const vless = (name: string, ip: string) => [
      `  - name: ${name}`,
      '    type: vless',
      `    server: ${ip}`,
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
    ].join('\n');
    const hy2 = (fingerprint: string, extra: string[] = []) => [
      '  - name: Tokyo · Sakura · hy2',
      '    type: hysteria2',
      '    server: 203.0.113.60',
      '    port: 443',
      '    password: {{TONO_CLIENT_UUID}}',
      '    sni: www.microsoft.com',
      `    fingerprint: ${fingerprint}`,
      ...extra,
    ].join('\n');
    const groups = [
      'proxy-groups:',
      '  - name: Tono-Exit',
      '    type: select',
      '    proxies:',
      '      - Tokyo · Sakura',
      '      - Tokyo · Sakura · hy2',
      '      - Tokyo · Fuji',
      'rules:',
      '  - MATCH,Tono-Exit',
    ].join('\n');
    const fp = 'e3aa4a745aa90539ab1a493d940eeba7b4305b7516ab84167e46c98ad9fed3db';
    const missingFp = [
      'proxies:',
      vless('Tokyo · Sakura', '203.0.113.60'),
      [
        '  - name: Tokyo · Sakura · hy2',
        '    type: hysteria2',
        '    server: 203.0.113.60',
        '    port: 443',
        '    password: {{TONO_CLIENT_UUID}}',
        '    sni: www.microsoft.com',
      ].join('\n'),
      vless('Tokyo · Fuji', '203.0.113.61'),
      groups,
    ].join('\n') + '\n';
    expectInvalidCatalog(missingFp);

    const skipVerify = [
      'proxies:',
      vless('Tokyo · Sakura', '203.0.113.60'),
      hy2(fp, ['    skip-cert-verify: true']),
      vless('Tokyo · Fuji', '203.0.113.61'),
      groups,
    ].join('\n') + '\n';
    expectInvalidCatalog(skipVerify);

    const yaml = [
      'proxies:',
      vless('Tokyo · Sakura', '203.0.113.60'),
      hy2(fp),
      vless('Tokyo · Fuji', '203.0.113.61'),
      groups,
    ].join('\n') + '\n';
    expect(managedCatalogYAML(yaml)).toBe(yaml);

    const plan = retirementCatalogPlan(yaml, 'Tokyo · Sakura');
    expect(plan.safe).toBe(true);
    expect(plan.changes.catalogEntryRemoved).toBe(true);
    expect(plan.yaml).toContain('Tokyo · Fuji');
    expect(plan.yaml).not.toContain('Tokyo · Sakura');
    expect(plan.yaml).not.toContain(' · hy2');
    expect(plan.yaml.match(/\{\{TONO_CLIENT_UUID\}\}/g)).toHaveLength(1);
  });
});
