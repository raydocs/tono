// Node self-registration v1 (backlog A20, decision D7-A): the public heartbeat
// route and the per-node token it authenticates with. The ops-side issue /
// revoke / list handlers are in handlers/node-agents.ts.
//
// A token is `tna1.<tokenId>.<secret>`. tokenId finds the row; the secret is
// checked against SHA-256(salt + ":" + secret) with a per-token salt, compared
// in constant time. The row binds the token to exactly one node name, and the
// heartbeat UPDATE is keyed on that name and that tokenId, so a token can only
// ever write its own node's heartbeat columns. It reaches nothing else: not the
// catalog, not ops_node_profiles.public_ip, not ops_node_status.

import { randomToken, sha256 } from '../crypto';
import { type Env, type Row, now, str } from '../env';
import { ApiError } from '../errors';
import { bearer } from '../auth';
import { body, rejectUnexpectedKeys } from '../request';
import { NODE_AGENT_ROLES, type NodeAgentRole } from './contract/node-agents';
import { consumeRateLimit } from './ingest-limits';

export const NODE_AGENT_HEARTBEAT_PATH = '/api/v1/node-agent/heartbeat';

const TOKEN_PREFIX = 'tna1';
const TOKEN_SHAPE = /^tna1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;
const RATE_WINDOW_SECONDS = 900;
/** Per source address, checked before any hashing. A node beats every 5 min. */
const HEARTBEATS_PER_IP = 30;
/** Per authenticated token. */
const HEARTBEATS_PER_TOKEN = 10;
const VERSION_SHAPE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,39}$/;
const IPV4_SHAPE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export type MintedNodeAgentToken = { token: string; tokenId: string; salt: string; hash: string };

async function saltedHash(salt: string, secret: string): Promise<string> {
  return sha256(`${salt}:${secret}`);
}

/** Equal-length base64url digests; the loop does not stop at the first difference. */
function sameDigest(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function mintNodeAgentToken(): Promise<MintedNodeAgentToken> {
  const tokenId = randomToken(12);
  const secret = randomToken(32);
  const salt = randomToken(16);
  return { token: `${TOKEN_PREFIX}.${tokenId}.${secret}`, tokenId, salt, hash: await saltedHash(salt, secret) };
}

/** An address in textual form, or null. Only ever stored, never dialled or routed. */
export function ipOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 2 || value.length > 45) return null;
  if (IPV4_SHAPE.test(value)) return value;
  if (value.includes(':') && isIpv6(value)) return value.toLowerCase();
  return null;
}

/**
 * RFC 4291 text form: hextets of 1–4 hex digits, at most one `::`, optionally
 * ending in a dotted IPv4 that counts as two hextets. No zone index.
 */
function isIpv6(value: string): boolean {
  let head = value;
  let embedded = 0;
  const lastColon = value.lastIndexOf(':');
  const tail = value.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!IPV4_SHAPE.test(tail)) return false;
    head = value.slice(0, lastColon + 1);
    if (!head.endsWith('::')) head = head.slice(0, -1);
    embedded = 2;
  }
  const halves = head.split('::');
  if (halves.length > 2) return false;
  const groups = (text: string | undefined) => (text ? text.split(':') : []);
  const hextets = [...groups(halves[0]), ...groups(halves[1])];
  if (!hextets.every((group) => /^[0-9A-Fa-f]{1,4}$/.test(group))) return false;
  const count = hextets.length + embedded;
  return halves.length === 2 ? count <= 7 : count === 8;
}

const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', 'Invalid node agent token');

/** The node this bearer token is bound to, or 401. A revoked token is a 403. */
export async function authenticateNodeAgent(req: Request, e: Env): Promise<{ node: string; tokenId: string }> {
  const match = TOKEN_SHAPE.exec(bearer(req));
  if (!match) throw unauthorized();
  const tokenId = match[1] ?? '';
  const secret = match[2] ?? '';
  let row: Row | null = null;
  try {
    row = await e.DB.prepare(
      'SELECT node_name, token_salt, token_hash, token_revoked_at FROM ops_node_agents WHERE token_id = ?',
    ).bind(tokenId).first<Row>();
  } catch (error) {
    if (!String(error).includes('no such table')) throw error;
  }
  // Hash even when the id is unknown, so a miss costs the same as a wrong secret.
  const actual = await saltedHash(String(row?.token_salt ?? 'x'.repeat(22)), secret);
  if (!row || !sameDigest(actual, String(row.token_hash))) throw unauthorized();
  if (row.token_revoked_at != null) {
    throw new ApiError(403, 'NODE_AGENT_REVOKED', 'This node agent token was revoked');
  }
  return { node: String(row.node_name), tokenId };
}

function rolesOf(value: unknown): NodeAgentRole[] {
  if (!Array.isArray(value) || value.length > NODE_AGENT_ROLES.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid roles');
  }
  const roles = new Set<NodeAgentRole>();
  for (const role of value) {
    if (!(NODE_AGENT_ROLES as readonly unknown[]).includes(role) || roles.has(role as NodeAgentRole)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid roles');
    }
    roles.add(role as NodeAgentRole);
  }
  return NODE_AGENT_ROLES.filter((role) => roles.has(role));
}

/**
 * `POST /api/v1/node-agent/heartbeat`. Body `{ node, ip?, roles, agentVersion }`;
 * `node` must be the token's own node. Writes only that node's heartbeat
 * columns in ops_node_agents.
 */
async function postHeartbeat(req: Request, e: Env): Promise<Response> {
  const observedIp = ipOrNull(req.headers.get('cf-connecting-ip'));
  await consumeRateLimit(
    e, `rl:${await sha256(`node-agent:ip:${observedIp ?? '-'}`)}`, HEARTBEATS_PER_IP, RATE_WINDOW_SECONDS,
  );
  const agent = await authenticateNodeAgent(req, e);
  await consumeRateLimit(
    e, `rl:${await sha256(`node-agent:token:${agent.tokenId}`)}`, HEARTBEATS_PER_TOKEN, RATE_WINDOW_SECONDS,
  );
  const b = await body(req, 4 * 1024);
  rejectUnexpectedKeys(b, ['node', 'ip', 'roles', 'agentVersion']);
  const node = str(b.node, 'node', 1, 200);
  if (node !== agent.node) {
    throw new ApiError(403, 'NODE_AGENT_MISMATCH', 'This token belongs to another node');
  }
  const reportedIp = b.ip == null ? null : ipOrNull(b.ip);
  if (b.ip != null && reportedIp === null) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid ip');
  const roles = rolesOf(b.roles);
  const agentVersion = str(b.agentVersion, 'agentVersion', 1, 40);
  if (!VERSION_SHAPE.test(agentVersion)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid agentVersion');
  const t = now();
  const updated = await e.DB.prepare(
    `UPDATE ops_node_agents
     SET reported_ip = ?, observed_ip = ?, roles = ?, agent_version = ?,
         first_heartbeat_at = COALESCE(first_heartbeat_at, ?), last_heartbeat_at = ?
     WHERE node_name = ? AND token_id = ? AND token_revoked_at IS NULL`,
  ).bind(reportedIp, observedIp, roles.join(','), agentVersion, t, t, agent.node, agent.tokenId).run();
  if (!Number(updated.meta.changes ?? 0)) {
    // Lost a race with revoke (same token id, now revoked) or with re-issue (id gone).
    const raced = await e.DB.prepare(
      'SELECT 1 FROM ops_node_agents WHERE token_id = ? AND token_revoked_at IS NOT NULL',
    ).bind(agent.tokenId).first();
    if (raced) throw new ApiError(403, 'NODE_AGENT_REVOKED', 'This node agent token was revoked');
    throw unauthorized();
  }
  return Response.json({ node: agent.node, receivedAt: t, observedIp });
}

export async function nodeAgentRoutes(req: Request, e: Env, p: string, m: string): Promise<Response | null> {
  if (p !== NODE_AGENT_HEARTBEAT_PATH) return null;
  if (m !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  return postHeartbeat(req, e);
}
