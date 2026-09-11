import { ApiError } from './errors';

export const CLIENT_UUID_PLACEHOLDER = '{{TONO_CLIENT_UUID}}';

/** Same-node backup block. Middle is space + interpunct + space. Folded onto the VLESS base name. */
export const HY2_NAME_SUFFIX = ' · hy2';

export function catalogBaseName(name: string): string {
  return name.endsWith(HY2_NAME_SUFFIX) ? name.slice(0, -HY2_NAME_SUFFIX.length) : name;
}

export function catalogHy2Name(base: string): string {
  return `${catalogBaseName(base)}${HY2_NAME_SUFFIX}`;
}

type RetireChanges = {
  catalogEntryRemoved: boolean;
  proxyGroupReferencesRemoved: string[];
  profileMarkedRetired: boolean;
};

function requireYaml(value: unknown): string {
  if (typeof value !== 'string' || value.length < 11 || value.length > 1024 * 1024) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid yaml');
  }
  return value;
}

export function managedCatalogYAML(value: unknown): string {
  const yaml = requireYaml(value);
  if (
    new TextEncoder().encode(yaml).byteLength > 1024 * 1024 ||
    yaml.includes('\0') ||
    yaml.split(/\r?\n/).some((line) => (
      line.length > 16 * 1024 ||
      [...line].some((character) => {
        const code = character.charCodeAt(0);
        return code < 0x09 || (code > 0x0D && code < 0x20) || code === 0x7F;
      })
    )) ||
    !/^proxies\s*:/m.test(yaml)
  ) {
    throw new ApiError(400, 'INVALID_CATALOG', 'Catalog must be bounded Clash YAML with a proxies section');
  }
  // Validate one identity on every proxy block, not merely every `uuid:` line
  // a line-oriented regex happens to see. `uuid: null`, a missing field, and a
  // flow mapping all evaded the old loop; a placeholder in a comment could then
  // make the publish tool's file-wide count look healthy while customers were
  // served a node they could never authenticate to.
  let items: Array<{ name: string; block: string }>;
  try {
    items = splitManagedCatalogProxies(yaml).items;
  } catch {
    throw new ApiError(400, 'INVALID_CATALOG', 'Catalog must contain a readable proxies list');
  }
  if (items.some(({ block }) => !catalogProxyUsesManagedIdentity(block))) {
    throw new ApiError(
      400,
      'INVALID_CATALOG',
      `Every catalog proxy must carry exactly one ${CLIENT_UUID_PLACEHOLDER} identity (uuid for vless, password for hysteria2)`,
    );
  }
  return yaml;
}

/** Extract the Clash proxy `name` from one list-item block under `proxies:`. */
export function catalogProxyName(block: string): string | null {
  for (const line of block.split(/\r?\n/)) {
    const flowMatch = line.match(
      /[{,]\s*name\s*:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^,}]+))/,
    );
    if (flowMatch) {
      const raw = flowMatch[1] ?? flowMatch[2] ?? flowMatch[3] ?? '';
      return raw.trim().replace(/\\(["'\\])/g, '$1');
    }
    const match = line.match(
      // The plain-scalar branch must accept internal spaces ("Los Angeles · Mesa"):
      // the publish tooling validates names with a real YAML parser, and a name this
      // regex cannot see fails the whole catalog closed for every filtered account.
      /^\s*(?:-\s+)?name:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s#"'][^#]*?))\s*(?:#.*)?$/,
    );
    if (!match) continue;
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    return raw.replace(/\\(["'\\])/g, '$1');
  }
  return null;
}

/**
 * Split a managed catalog into `proxies:` list items without a full YAML parser.
 * Only top-level dash items under `proxies:` are treated as nodes; other document
 * keys after the list are preserved in the suffix.
 */
export function splitManagedCatalogProxies(yaml: string): {
  prefix: string;
  items: Array<{ name: string; block: string }>;
  suffix: string;
} {
  const normalized = yaml.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  let proxiesIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^proxies\s*:\s*(?:#.*)?$/.test(lines[i]) || /^proxies\s*:\s*\[\s*\]\s*(?:#.*)?$/.test(lines[i])) {
      proxiesIdx = i;
      break;
    }
  }
  if (proxiesIdx < 0) {
    throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Managed server catalog is missing a proxies list');
  }
  if (/^proxies\s*:\s*\[\s*\]\s*(?:#.*)?$/.test(lines[proxiesIdx])) {
    return {
      prefix: `${lines.slice(0, proxiesIdx + 1).join('\n')}\n`,
      items: [],
      suffix: lines.slice(proxiesIdx + 1).join('\n'),
    };
  }

  let itemIndent: number | null = null;
  const itemStarts: number[] = [];
  let listEnd = lines.length;
  for (let i = proxiesIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent === 0 && !line.trimStart().startsWith('-')) {
      listEnd = i;
      break;
    }
    if (/^\s*-\s+/.test(line)) {
      if (itemIndent === null) itemIndent = indent;
      if (indent === itemIndent) itemStarts.push(i);
    }
  }

  if (itemStarts.length === 0) {
    return {
      prefix: lines.slice(0, proxiesIdx + 1).join('\n') + '\n',
      items: [],
      suffix: lines.slice(listEnd).join('\n'),
    };
  }

  const items: Array<{ name: string; block: string }> = [];
  for (let n = 0; n < itemStarts.length; n++) {
    const start = itemStarts[n];
    const end = n + 1 < itemStarts.length ? itemStarts[n + 1] : listEnd;
    const block = lines.slice(start, end).join('\n');
    const name = catalogProxyName(block);
    if (!name) {
      throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Managed server catalog has an unnamed proxy entry');
    }
    items.push({ name, block });
  }

  return {
    prefix: lines.slice(0, proxiesIdx + 1).join('\n') + '\n',
    items,
    suffix: lines.slice(listEnd).join('\n'),
  };
}

function catalogProxyType(block: string): string {
  for (const line of block.split(/\r?\n/)) {
    const flow = line.match(/[{,]\s*type\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\s,}]+))/);
    if (flow) return (flow[1] ?? flow[2] ?? flow[3] ?? '').trim();
    const match = line.match(/^\s*(?:-\s+)?type:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/);
    if (match) return (match[1] ?? match[2] ?? match[3] ?? '').trim();
  }
  return 'vless';
}

function catalogFieldKeys(block: string, field: 'uuid' | 'password'): number {
  return [
    ...block.matchAll(new RegExp(String.raw`^\s*(?:-\s*)?${field}\s*:`, 'gm')),
    ...block.matchAll(new RegExp(String.raw`[{,]\s*${field}\s*:`, 'g')),
  ].length;
}

function catalogFieldIsPlaceholder(block: string, field: 'uuid' | 'password'): boolean {
  if (catalogFieldKeys(block, field) !== 1) return false;
  const placeholder = String.raw`(?:["']\{\{TONO_CLIENT_UUID\}\}["']|\{\{TONO_CLIENT_UUID\}\})`;
  const blockValue = new RegExp(
    String.raw`^\s*(?:-\s*)?${field}\s*:\s*${placeholder}\s*(?:#.*)?$`,
    'm',
  );
  const flowValue = new RegExp(
    String.raw`[{,]\s*${field}\s*:\s*${placeholder}\s*(?=[,}])`,
  );
  return blockValue.test(block) || flowValue.test(block);
}

function catalogHasFingerprint(block: string): boolean {
  const line = block.match(/^\s*(?:-\s*)?fingerprint\s*:\s*(.+?)\s*(?:#.*)?$/m);
  const flow = block.match(/[{,]\s*fingerprint\s*:\s*([^,}]+)/);
  const raw = (line?.[1] ?? flow?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  return raw.length > 0 && !raw.includes('TONO_CLIENT_UUID');
}

function catalogSkipsCertVerify(block: string): boolean {
  return /skip-cert-verify\s*:\s*(?:true|True|yes)\b/.test(block);
}

/**
 * A proxy block has exactly one managed identity placeholder.
 * VLESS: `uuid: {{TONO_CLIENT_UUID}}`. Hysteria2: `password: {{TONO_CLIENT_UUID}}`,
 * a certificate fingerprint, no `skip-cert-verify: true`, and a ` · hy2` name.
 */
export function catalogProxyUsesManagedIdentity(block: string): boolean {
  const type = catalogProxyType(block);
  const name = catalogProxyName(block);
  if (type === 'hysteria2') {
    if (!name || !name.endsWith(HY2_NAME_SUFFIX) || catalogBaseName(name).length === 0) return false;
    if (catalogFieldKeys(block, 'uuid') !== 0) return false;
    return catalogFieldIsPlaceholder(block, 'password')
      && catalogHasFingerprint(block)
      && !catalogSkipsCertVerify(block);
  }
  if (type !== 'vless') return false;
  if (name?.endsWith(HY2_NAME_SUFFIX)) return false;
  return catalogFieldIsPlaceholder(block, 'uuid');
}

/**
 * Shared proxies stay for every authenticated user. Active home-exit proxy names
 * are withheld unless the user is bound to that exact home exit.
 */
export function filterCatalogYamlForUser(
  yaml: string,
  restrictedHomeNames: Set<string>,
  allowedHomeNames: Set<string>,
): string {
  if (restrictedHomeNames.size === 0) return yaml;
  const { prefix, items, suffix } = splitManagedCatalogProxies(yaml);
  if (items.length === 0) return yaml;
  const kept = items.filter(
    (item) => !restrictedHomeNames.has(item.name) || allowedHomeNames.has(item.name),
  );
  if (kept.length === items.length) return yaml;
  if (kept.length === 0) {
    const empty = 'proxies: []\n';
    return suffix.trim() ? `${empty}${suffix.startsWith('\n') ? suffix.slice(1) : suffix}` : empty;
  }
  const body = kept.map((item) => item.block.replace(/\s+$/, '')).join('\n') + '\n';
  const joined = `${prefix}${body}${suffix}`;
  return joined.endsWith('\n') ? joined : `${joined}\n`;
}

/**
 * Same-node hy2 is opt-in. Old clients cannot admit `type: hysteria2`; serving
 * those blocks to everyone would fail closed. Keep them only for the gray list.
 * Never YAML-parse: the identity placeholder is legal flow-mapping syntax.
 */
export function filterHy2CatalogForViewer(yaml: string, keepHy2: boolean): string {
  if (keepHy2 || !yaml.includes(HY2_NAME_SUFFIX)) return yaml;
  const { prefix, items, suffix } = splitManagedCatalogProxies(yaml);
  const dropped = items.filter((item) => item.name.endsWith(HY2_NAME_SUFFIX));
  if (dropped.length === 0) return yaml;
  const kept = items.filter((item) => !item.name.endsWith(HY2_NAME_SUFFIX));
  if (kept.length === 0) {
    const empty = 'proxies: []\n';
    return suffix.trim() ? `${empty}${suffix.startsWith('\n') ? suffix.slice(1) : suffix}` : empty;
  }
  const body = kept.map((item) => item.block.replace(/\s+$/, '')).join('\n') + '\n';
  let next = `${prefix}${body}${suffix}`;
  if (!next.endsWith('\n')) next += '\n';
  const names = dropped.map((item) => item.name);
  const aliasPattern = names.map(escapeRegExp).join('|');
  const memberLine = new RegExp(`^([ \\t]+)-[ \\t]+(?:${aliasPattern})[ \\t]*(?:#.*)?$`);
  let inGroups = false;
  const keptLines: string[] = [];
  for (const line of next.split('\n')) {
    if (/^proxy-groups\s*:/.test(line)) {
      inGroups = true;
      keptLines.push(line);
      continue;
    }
    if (inGroups && line.trim() && !/^\s/.test(line) && !line.trimStart().startsWith('#')) {
      inGroups = false;
    }
    if (inGroups && memberLine.test(line)) continue;
    keptLines.push(line);
  }
  next = keptLines.join('\n');
  if (yaml.endsWith('\n') && !next.endsWith('\n')) next += '\n';
  return next;
}

export function hy2CatalogEmailAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.includes('@')),
  );
}

/** New clients send `X-Tono-Accept: hy2`. Old clients omit it and still get hy2 stripped. */
export function requestAcceptsHy2Catalog(header: string | null | undefined): boolean {
  if (!header) return false;
  return header
    .split(',')
    .some((part) => part.trim().toLowerCase() === 'hy2');
}

function placeholderCount(yaml: string): number {
  return yaml.split(CLIENT_UUID_PLACEHOLDER).length - 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function catalogGroupName(line: string): string | null {
  const match = line.match(
    /^\s*(?:-\s+)?name:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s#"'][^#]*?))\s*(?:#.*)?$/,
  );
  if (!match) return null;
  return (match[1] ?? match[2] ?? match[3] ?? '').trim() || null;
}

function emptyProxyGroupNames(yaml: string): string[] {
  const empty: string[] = [];
  let inGroups = false;
  let group: string | null = null;
  let awaitingMembers = false;
  let members = 0;
  const finish = () => {
    if (awaitingMembers && members === 0 && group) empty.push(group);
    awaitingMembers = false;
    members = 0;
  };
  for (const line of yaml.split('\n')) {
    if (/^proxy-groups\s*:/.test(line)) {
      finish();
      inGroups = true;
      continue;
    }
    if (inGroups && line.trim() && !/^\s/.test(line) && !line.trimStart().startsWith('#')) {
      finish();
      inGroups = false;
    }
    if (!inGroups) continue;
    const named = catalogGroupName(line);
    if (named && /^\s*-\s+/.test(line)) {
      finish();
      group = named;
      continue;
    }
    if (/^\s+proxies\s*:/.test(line)) {
      awaitingMembers = true;
      members = 0;
      continue;
    }
    if (awaitingMembers) {
      if (line.trim() === '' || /^\s*#/.test(line)) continue;
      if (/^\s+-\s+/.test(line)) {
        members += 1;
        continue;
      }
      finish();
    }
  }
  finish();
  return empty;
}

/**
 * Remove one catalog proxy by rewriting text, never by YAML parse/dump.
 * `{{TONO_CLIENT_UUID}}` is legal YAML flow-mapping syntax; round-tripping
 * would rewrite every remaining identity into a nested map and brick the fleet.
 */
export function retirementCatalogPlan(yaml: string, name: string): {
  yaml: string;
  changes: RetireChanges;
  warnings: string[];
  safe: boolean;
} {
  const warnings: string[] = [];
  const placeholdersBefore = placeholderCount(yaml);
  let prefix = '';
  let items: Array<{ name: string; block: string }> = [];
  let suffix = '';
  try {
    ({ prefix, items, suffix } = splitManagedCatalogProxies(yaml));
  } catch {
    return {
      yaml,
      changes: { catalogEntryRemoved: false, proxyGroupReferencesRemoved: [], profileMarkedRetired: false },
      warnings: ['目录没有可安全编辑的 proxies 列表。'],
      safe: false,
    };
  }
  const seenNames = new Set<string>();
  for (const item of items) {
    if (seenNames.has(item.name)) {
      return {
        yaml,
        changes: { catalogEntryRemoved: false, proxyGroupReferencesRemoved: [], profileMarkedRetired: false },
        warnings: ['目录中存在多个同名节点，拒绝自动退役。'],
        safe: false,
      };
    }
    seenNames.add(item.name);
  }
  const base = catalogBaseName(name);
  const aliases = new Set([base, catalogHy2Name(base)]);
  const matches = items.filter((item) => aliases.has(item.name));
  if (matches.length === 0) {
    return {
      yaml,
      changes: { catalogEntryRemoved: false, proxyGroupReferencesRemoved: [], profileMarkedRetired: false },
      warnings: [],
      safe: false,
    };
  }
  if (items.length - matches.length < 1) {
    return {
      yaml,
      changes: { catalogEntryRemoved: true, proxyGroupReferencesRemoved: [], profileMarkedRetired: false },
      warnings: ['不能退役目录中的最后一个节点。'],
      safe: false,
    };
  }

  const placeholdersRemoved = matches.reduce((sum, item) => sum + placeholderCount(item.block), 0);
  let next = yaml;
  if (matches.length > 0) {
    const kept = items.filter((item) => !aliases.has(item.name));
    const body = kept.map((item) => item.block.replace(/\s+$/, '')).join('\n') + '\n';
    next = `${prefix}${body}${suffix}`;
    if (!next.endsWith('\n')) next += '\n';
  }

  const aliasPattern = [...aliases].map(escapeRegExp).join('|');
  const memberLine = new RegExp(`^([ \\t]+)-[ \\t]+(?:${aliasPattern})[ \\t]*(?:#.*)?$`);
  const groupsChanged: string[] = [];
  let inGroups = false;
  let currentGroup: string | null = null;
  const keptLines: string[] = [];
  for (const line of next.split('\n')) {
    if (/^proxy-groups\s*:/.test(line)) {
      inGroups = true;
      keptLines.push(line);
      continue;
    }
    if (inGroups && line.trim() && !/^\s/.test(line) && !line.trimStart().startsWith('#')) {
      inGroups = false;
    }
    if (inGroups) {
      const named = catalogGroupName(line);
      if (named && /^\s*-\s+/.test(line)) currentGroup = named;
      if (memberLine.test(line)) {
        const groupName = currentGroup ?? '未命名';
        if (!groupsChanged.includes(groupName)) groupsChanged.push(groupName);
        continue;
      }
    }
    keptLines.push(line);
  }
  next = keptLines.join('\n');
  if (yaml.endsWith('\n') && !next.endsWith('\n')) next += '\n';

  const ruleTarget = new RegExp(`,\\s*(?:${aliasPattern})\\s*(?:,\\s*no-resolve)?\\s*$`, 'i');
  let inRules = false;
  for (const line of next.split('\n')) {
    if (/^rules\s*:/.test(line)) {
      inRules = true;
      continue;
    }
    if (inRules && line.trim() && !/^\s/.test(line) && !line.trimStart().startsWith('#')) break;
    if (!inRules) continue;
    const value = line.trim().replace(/^-\s+/, '');
    if (ruleTarget.test(value)) {
      warnings.push('规则列表直接引用了该节点，需先改为代理组。');
      break;
    }
  }

  for (const groupName of emptyProxyGroupNames(next)) {
    warnings.push(`退役会清空代理组 ${groupName}。`);
  }

  const placeholdersAfter = placeholderCount(next);
  if (placeholdersAfter !== placeholdersBefore - placeholdersRemoved) {
    warnings.push('退役后目录占位符数量与预期不符，拒绝自动改写。');
  }
  if (next.includes('TONO_CLIENT_UUID') && !next.includes(CLIENT_UUID_PLACEHOLDER)) {
    warnings.push('退役改写破坏了客户端占位符。');
  }

  const blocked = warnings.some((warning) => (
    warning.startsWith('规则列表')
    || warning.includes('占位符')
    || warning.startsWith('退役会清空')
  ));
  const safe = matches.length >= 1 && !blocked;
  if (safe) {
    try {
      next = managedCatalogYAML(next);
    } catch {
      warnings.push('改写后的目录未通过发布校验。');
      return {
        yaml,
        changes: { catalogEntryRemoved: true, proxyGroupReferencesRemoved: groupsChanged, profileMarkedRetired: false },
        warnings,
        safe: false,
      };
    }
  }

  return {
    yaml: safe ? next : yaml,
    changes: {
      catalogEntryRemoved: matches.length > 0,
      proxyGroupReferencesRemoved: groupsChanged,
      profileMarkedRetired: false,
    },
    warnings,
    safe,
  };
}

/** Inverse of retirementCatalogPlan: put one proxy block back into `proxies:`. */
export function relistCatalogPlan(yaml: string, name: string, block: string): {
  yaml: string;
  alreadyListed: boolean;
  warnings: string[];
  safe: boolean;
} {
  const warnings: string[] = [];
  let prefix = '';
  let items: Array<{ name: string; block: string }> = [];
  let suffix = '';
  try {
    ({ prefix, items, suffix } = splitManagedCatalogProxies(yaml));
  } catch {
    return { yaml, alreadyListed: false, warnings: ['目录没有可安全编辑的 proxies 列表。'], safe: false };
  }
  if (items.some((item) => item.name === name)) {
    return { yaml, alreadyListed: true, warnings, safe: true };
  }
  if (!catalogProxyUsesManagedIdentity(block) || catalogProxyName(block) !== name) {
    return { yaml, alreadyListed: false, warnings: ['上架模板不是该节点的有效目录条目。'], safe: false };
  }
  const body = [...items.map((item) => item.block.replace(/\s+$/, '')), block.replace(/\s+$/, '')].join('\n') + '\n';
  let next = `${prefix}${body}${suffix}`;
  if (!next.endsWith('\n')) next += '\n';
  const member = `      - ${name}`;
  const lines = next.split('\n');
  let inGroups = false;
  let inTono = false;
  let inProxies = false;
  let inserted = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^proxy-groups\s*:/.test(line)) {
      inGroups = true;
      inTono = false;
      inProxies = false;
      out.push(line);
      continue;
    }
    if (inGroups && line.trim() && !/^\s/.test(line) && !line.trimStart().startsWith('#')) {
      if (inTono && inProxies && !inserted) out.push(member);
      inGroups = false;
      inTono = false;
      inProxies = false;
    }
    if (inGroups) {
      const named = catalogGroupName(line);
      if (named && /^\s*-\s+/.test(line)) {
        if (inTono && inProxies && !inserted) out.push(member);
        inTono = named === 'Tono-Exit';
        inProxies = false;
      }
      if (inTono && /^\s+proxies\s*:/.test(line)) inProxies = true;
      if (inTono && inProxies && new RegExp(`^[ \\t]+-[ \\t]+${escapeRegExp(name)}[ \\t]*(?:#.*)?$`).test(line)) {
        inserted = true;
      }
    }
    out.push(line);
  }
  if (inTono && inProxies && !inserted) out.push(member);
  next = out.join('\n');
  if (yaml.endsWith('\n') && !next.endsWith('\n')) next += '\n';
  try {
    next = managedCatalogYAML(next);
  } catch {
    warnings.push('改写后的目录未通过发布校验。');
    return { yaml, alreadyListed: false, warnings, safe: false };
  }
  return { yaml: next, alreadyListed: false, warnings, safe: true };
}
