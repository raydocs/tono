import { describe, expect, it } from 'vitest';
import {
  checkCatalog,
  checkPolicy,
  documentDiff,
  policyText,
  stashPolicyDraft,
  takePolicyDraft,
  withoutAnyDirect,
  withoutWebDirect,
  type PolicyDocument,
} from './settings-publish';

const IDENTITY = '{{TONO_CLIENT_UUID}}';

function catalogOf(...names: string[]): string {
  const blocks = names.map((name) => [
    `  - name: ${name}`,
    '    type: vless',
    `    server: ${name}.example.net`,
    '    port: 443',
    `    uuid: ${IDENTITY}`,
  ].join('\n'));
  return ['proxies:', ...blocks, ''].join('\n');
}

describe('checkCatalog', () => {
  it('counts the machines a good catalogue would publish', () => {
    const check = checkCatalog(catalogOf('tokyo-01', 'osaka-02'));
    expect(check).toEqual({ ok: true, nodes: 2 });
  });

  it('accepts a deliberately empty list rather than calling it broken', () => {
    expect(checkCatalog('proxies: []\n# nothing listed today')).toEqual({ ok: true, nodes: 0 });
  });

  it('refuses a document with no proxies section', () => {
    const check = checkCatalog('rules:\n  - MATCH,DIRECT\n');
    expect(check).toEqual({ ok: false, fault: 'noProxies', nodes: null });
  });

  it('refuses a proxies list the hub reads line by line and cannot read', () => {
    const check = checkCatalog('proxies: [{name: a, uuid: x}]\n# inline list');
    expect(check).toEqual({ ok: false, fault: 'unreadable', nodes: null });
  });

  /**
   * The one that matters: a node whose uuid is somebody's literal id is a node
   * every customer is served and none of them can authenticate to.
   */
  it('refuses a node whose identity is not the shared token', () => {
    const yaml = catalogOf('tokyo-01').replace(IDENTITY, '2f1c6a80-0000-4000-8000-000000000000');
    expect(checkCatalog(yaml)).toEqual({ ok: false, fault: 'identity', nodes: 1 });
  });

  it('refuses a document carrying characters nobody can see', () => {
    const yaml = catalogOf('tokyo-01').replace('tokyo-01', 'tokyo\u0007-01');
    expect(checkCatalog(yaml)).toEqual({ ok: false, fault: 'controlChar', nodes: null });
  });

  it('refuses something too short to be a catalogue at all', () => {
    expect(checkCatalog('  ')).toEqual({ ok: false, fault: 'empty', nodes: null });
  });
});

const V4: PolicyDocument = {
  version: 4,
  domains: [{ host: 'wechat.com', ports: [443] }],
  mediaEndpoints: [{ address: '203.0.113.7', ports: [8000] }],
  webDomains: [{ host: 'bilibili.com', ports: [443] }],
  directSuffixes: [{ host: 'baidu.com', ports: [443] }],
  tcpEndpoints: [],
};

describe('checkPolicy', () => {
  it('tells unreadable text apart from a readable shape it does not know', () => {
    expect(checkPolicy('{ not json')).toEqual({ ok: false, fault: 'json' });
    expect(checkPolicy('{"version":9}')).toEqual({ ok: false, fault: 'shape' });
  });

  it('accepts a rule set the hub would accept', () => {
    const check = checkPolicy(JSON.stringify(V4));
    expect(check.ok).toBe(true);
  });
});

describe('the quick ways to close a direct path', () => {
  it('empties only the browser list, and never moves the version', () => {
    const text = withoutWebDirect(V4);
    expect(text).not.toBeNull();
    const next = JSON.parse(text!) as PolicyDocument;
    expect(next.version).toBe(4);
    expect(next).toMatchObject({ webDomains: [], directSuffixes: [{ host: 'baidu.com', ports: [443] }] });
  });

  it('says nothing to do rather than writing an identical draft', () => {
    expect(withoutWebDirect({ ...V4, webDomains: [] })).toBeNull();
  });

  it('empties every list the version carries', () => {
    const next = JSON.parse(withoutAnyDirect(V4)) as PolicyDocument;
    expect(next).toEqual({
      version: 4,
      domains: [],
      mediaEndpoints: [],
      webDomains: [],
      directSuffixes: [],
      tcpEndpoints: [],
    });
  });
});

describe('policyText', () => {
  it('lays the stored one-liner out so a comparison has lines to compare', () => {
    expect(policyText('{"version":1,"domains":[],"mediaEndpoints":[]}').split('\n').length)
      .toBeGreaterThan(1);
  });

  it('hands back text it cannot read, rather than losing it', () => {
    expect(policyText('{ half a document')).toBe('{ half a document');
  });
});

describe('the draft handed between sections', () => {
  it('arrives once and is gone on the next look', () => {
    stashPolicyDraft('{"version":1}');
    expect(takePolicyDraft()).toBe('{"version":1}');
    expect(takePolicyDraft()).toBeNull();
  });
});

describe('documentDiff', () => {
  it('counts the lines a publish would add and take away', () => {
    const diff = documentDiff('a\nb\nc\n', 'a\nc\nd\n');
    expect({ added: diff.added, removed: diff.removed }).toEqual({ added: 1, removed: 1 });
  });
});
