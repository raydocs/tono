export type PolicyHost = { host: string; ports: number[] };
export type PolicyEndpoint = { address: string; ports: number[] };

export type TrafficPolicyDoc =
  | { version: 1; domains: PolicyHost[]; mediaEndpoints: PolicyEndpoint[] }
  | { version: 2; domains: PolicyHost[]; mediaEndpoints: PolicyEndpoint[]; webDomains: PolicyHost[] }
  | { version: 3; domains: PolicyHost[]; mediaEndpoints: PolicyEndpoint[]; webDomains: PolicyHost[]; directSuffixes: PolicyHost[] }
  | {
    version: 4;
    domains: PolicyHost[];
    mediaEndpoints: PolicyEndpoint[];
    webDomains: PolicyHost[];
    directSuffixes: PolicyHost[];
    tcpEndpoints: PolicyEndpoint[];
  };

export type PolicyParse =
  | { ok: true; policy: TrafficPolicyDoc }
  | { ok: false; reason: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function keysOf(value: Record<string, unknown>) {
  return Object.keys(value).sort();
}

function sameKeys(value: Record<string, unknown>, expected: string[]) {
  const have = keysOf(value);
  const want = [...expected].sort();
  return have.length === want.length && have.every((key, index) => key === want[index]);
}

function isHostList(value: unknown): value is PolicyHost[] {
  return Array.isArray(value) && value.every((entry) => (
    isObject(entry)
    && typeof entry.host === 'string'
    && Array.isArray(entry.ports)
    && entry.ports.every((port) => typeof port === 'number')
  ));
}

function isEndpointList(value: unknown): value is PolicyEndpoint[] {
  return Array.isArray(value) && value.every((entry) => (
    isObject(entry)
    && typeof entry.address === 'string'
    && Array.isArray(entry.ports)
    && entry.ports.every((port) => typeof port === 'number')
  ));
}

export function parseTrafficPolicy(value: unknown): PolicyParse {
  if (!isObject(value)) return { ok: false, reason: '不是对象' };
  if (!isHostList(value.domains) || !isEndpointList(value.mediaEndpoints)) {
    return { ok: false, reason: 'domains 或 mediaEndpoints 不合法' };
  }
  if (value.version === 1 && sameKeys(value, ['version', 'domains', 'mediaEndpoints'])) {
    return { ok: true, policy: { version: 1, domains: value.domains, mediaEndpoints: value.mediaEndpoints } };
  }
  if (value.version === 2 && sameKeys(value, ['version', 'domains', 'mediaEndpoints', 'webDomains'])) {
    if (!isHostList(value.webDomains)) return { ok: false, reason: 'webDomains 不合法' };
    return {
      ok: true,
      policy: { version: 2, domains: value.domains, mediaEndpoints: value.mediaEndpoints, webDomains: value.webDomains },
    };
  }
  if (value.version === 3 && sameKeys(value, ['version', 'domains', 'mediaEndpoints', 'webDomains', 'directSuffixes'])) {
    if (!isHostList(value.webDomains) || !isHostList(value.directSuffixes)) {
      return { ok: false, reason: 'webDomains 或 directSuffixes 不合法' };
    }
    return {
      ok: true,
      policy: {
        version: 3,
        domains: value.domains,
        mediaEndpoints: value.mediaEndpoints,
        webDomains: value.webDomains,
        directSuffixes: value.directSuffixes,
      },
    };
  }
  if (value.version === 4 && sameKeys(value, ['version', 'domains', 'mediaEndpoints', 'webDomains', 'directSuffixes', 'tcpEndpoints'])) {
    if (!isHostList(value.webDomains) || !isHostList(value.directSuffixes) || !isEndpointList(value.tcpEndpoints)) {
      return { ok: false, reason: 'v4 字段不合法' };
    }
    return {
      ok: true,
      policy: {
        version: 4,
        domains: value.domains,
        mediaEndpoints: value.mediaEndpoints,
        webDomains: value.webDomains,
        directSuffixes: value.directSuffixes,
        tcpEndpoints: value.tcpEndpoints,
      },
    };
  }
  return { ok: false, reason: '无法识别的规则版本或字段' };
}

export function parseTrafficPolicyText(text: string): PolicyParse {
  try {
    return parseTrafficPolicy(JSON.parse(text) as unknown);
  } catch {
    return { ok: false, reason: '不是合法 JSON' };
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Close browser web-direct only. Never upgrades/downgrades version or fills missing lists. */
export function clearWebDomains(policy: TrafficPolicyDoc): PolicyParse {
  if (policy.version === 1) {
    return { ok: false, reason: '当前没有网页直连规则' };
  }
  const next = clone(policy);
  next.webDomains = [];
  return { ok: true, policy: next };
}

/** Close every direct path: empty each list the version carries. Never upgrades/downgrades version. */
export function clearAllDirect(policy: TrafficPolicyDoc): TrafficPolicyDoc {
  const next = clone(policy);
  next.domains = [];
  next.mediaEndpoints = [];
  if (next.version !== 1) next.webDomains = [];
  if (next.version === 3 || next.version === 4) next.directSuffixes = [];
  if (next.version === 4) next.tcpEndpoints = [];
  return next;
}

export function hasWebDomains(policy: TrafficPolicyDoc): boolean {
  return policy.version !== 1 && policy.webDomains.length > 0;
}
