import { catalogProxyNames } from '@legacy-lib/catalog';
import { lineDiff, type LineDiff } from '@legacy-lib/textdiff';
import {
  clearAllDirect,
  clearWebDomains,
  hasWebDomains,
  parseTrafficPolicy,
  type TrafficPolicyDoc as PolicyDocument,
} from '@legacy-lib/traffic-policy';

/**
 * What has to be true of a draft before it is allowed near the fleet.
 *
 * Both checks here are deliberately the hub's own checks rather than a generic
 * parse. The hub does not read the catalogue with a YAML library — it walks the
 * `proxies:` list line by line — so a document a YAML parser is happy with can
 * still be refused, and a document it dislikes can still be exactly what the
 * fleet has been serving for a year. Guessing with a different validator would
 * put a green tick in front of a publish that then 400s, which is the one place
 * a settings page must not be optimistic.
 *
 * The routing rules do have a real validator: the old console's
 * `parseTrafficPolicy` is the same structural check the hub applies, so it is
 * reused rather than rewritten.
 */

const IDENTITY = '{{TONO_CLIENT_UUID}}';
const MAX_BYTES = 1024 * 1024;
const MAX_LINE = 16 * 1024;
const MIN_LENGTH = 11;

export type CatalogFault =
  | 'empty'
  | 'tooBig'
  | 'controlChar'
  | 'noProxies'
  | 'unreadable'
  | 'identity';

export type CatalogCheck =
  | { ok: true; nodes: number }
  | { ok: false; fault: CatalogFault; nodes: number | null };

function hasControlCharacter(line: string): boolean {
  if (line.length > MAX_LINE) return true;
  for (const character of line) {
    const code = character.charCodeAt(0);
    if (code < 0x09 || (code > 0x0d && code < 0x20) || code === 0x7f) return true;
  }
  return false;
}

/** How many times the shared identity token appears, anywhere in the text. */
function identityCount(text: string): number {
  let found = 0;
  let at = text.indexOf(IDENTITY);
  while (at >= 0) {
    found += 1;
    at = text.indexOf(IDENTITY, at + IDENTITY.length);
  }
  return found;
}

/**
 * The catalogue draft, checked the way the hub checks it.
 *
 * The identity clause is the one worth being strict about: a proxy block whose
 * `uuid` is not the shared token is a node every customer would be served and
 * none of them could authenticate to, and the hub refuses the whole document
 * for it. Counting tokens against nodes catches the two ways that happens —
 * a block pasted in with somebody's literal id, and a block with no `uuid` at
 * all — before the operator has spent a confirmation on it.
 */
export function checkCatalog(text: string): CatalogCheck {
  if (text.trim().length < MIN_LENGTH) return { ok: false, fault: 'empty', nodes: null };
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) {
    return { ok: false, fault: 'tooBig', nodes: null };
  }
  const lines = text.split(/\r?\n/);
  if (text.includes('\0') || lines.some(hasControlCharacter)) {
    return { ok: false, fault: 'controlChar', nodes: null };
  }
  const head = lines.find((line) => /^proxies\s*:/.test(line));
  if (head === undefined) return { ok: false, fault: 'noProxies', nodes: null };
  // The hub only walks a `proxies:` that owns its line, or an explicit empty
  // list. Anything else — a flow sequence on the same line — is a document it
  // cannot read the nodes out of.
  const readable = /^proxies\s*:\s*(?:#.*)?$/.test(head)
    || /^proxies\s*:\s*\[\s*\]\s*(?:#.*)?$/.test(head);
  if (!readable) return { ok: false, fault: 'unreadable', nodes: null };
  const nodes = catalogProxyNames(text).length;
  if (identityCount(text) !== nodes) return { ok: false, fault: 'identity', nodes };
  return { ok: true, nodes };
}

export type PolicyFault = 'json' | 'shape';

export type PolicyCheck =
  | { ok: true; policy: PolicyDocument }
  | { ok: false; fault: PolicyFault };

export function checkPolicy(text: string): PolicyCheck {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, fault: 'json' };
  }
  const parsed = parseTrafficPolicy(value);
  return parsed.ok ? { ok: true, policy: parsed.policy } : { ok: false, fault: 'shape' };
}

/**
 * The rules, laid out for a human to edit.
 *
 * What the hub stores and signs is minified — one line, four thousand
 * characters — and a diff of one line against one line says only "it changed".
 * The editor therefore holds an indented copy, and the publish sends the parsed
 * object, so the whitespace this adds never reaches the wire. The canonical
 * text is still shown verbatim by 试运行, which is the copy a signature covers.
 */
export function policyText(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json) as unknown, null, 2);
  } catch {
    return json;
  }
}

export function policyDraftText(policy: PolicyDocument): string {
  return JSON.stringify(policy, null, 2);
}

/** 关闭网页直连 — or nothing, when this document has no web list to close. */
export function withoutWebDirect(policy: PolicyDocument): string | null {
  if (!hasWebDomains(policy)) return null;
  const next = clearWebDomains(policy);
  return next.ok ? policyDraftText(next.policy) : null;
}

/** 关掉全部直连 — every list this version carries, emptied. Version never moves. */
export function withoutAnyDirect(policy: PolicyDocument): string {
  return policyDraftText(clearAllDirect(policy));
}

export type { PolicyDocument, LineDiff };

export function documentDiff(before: string, after: string): LineDiff {
  return lineDiff(before, after);
}

/**
 * The one draft in flight between two sections.
 *
 * 直连候选 can build a routing draft, and the only place it can be published
 * from is the rules editor. Handing it over through a module-level slot rather
 * than the hash keeps a four-kilobyte document out of the address bar, and
 * taking it empties the slot so a later visit to the editor does not silently
 * re-apply a draft the operator has already walked away from.
 */
let handoff: string | null = null;

export function stashPolicyDraft(text: string): void {
  handoff = text;
}

export function takePolicyDraft(): string | null {
  const text = handoff;
  handoff = null;
  return text;
}
