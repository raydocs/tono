import { ApiError } from '../../errors';
import { opsAuditStatement } from '../../product-account';
import {
  assertNodeAgents,
  NODE_AGENT_ROLES,
  type NodeAgentRole,
  type NodeAgentTokenDto,
  type NodeAgentsDto,
} from '../contract';
import { mintNodeAgentToken } from '../node-agent';
import {
  type Actor,
  type Env,
  type Row,
  decodeName,
  entityJson,
  jsonNoStore,
  missingTable,
  now,
  nullInt,
  nullText,
  weakEtag,
} from './common';
import { requireNode } from './nodes-data';

function auditMeta(actor: Actor) {
  return { actorType: 'access_admin' as const, actorRole: actor.role ?? 'owner' };
}

function rolesFrom(value: unknown): NodeAgentRole[] {
  const listed = String(value ?? '').split(',');
  return NODE_AGENT_ROLES.filter((role) => listed.includes(role));
}

/** `GET /api/v1/ops/node-agents` (nodes.read): every issued agent token and its last heartbeat. */
export async function getNodeAgents(req: Request, e: Env): Promise<Response> {
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      `SELECT node_name, token_issued_at, token_revoked_at, reported_ip, observed_ip, roles,
              agent_version, first_heartbeat_at, last_heartbeat_at
       FROM ops_node_agents ORDER BY node_name`,
    ).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const body: NodeAgentsDto = {
    agents: rows.map((row) => ({
      node: String(row.node_name),
      tokenIssuedAt: Number(row.token_issued_at),
      tokenRevokedAt: nullInt(row.token_revoked_at),
      reportedIp: nullText(row.reported_ip),
      observedIp: nullText(row.observed_ip),
      roles: rolesFrom(row.roles),
      agentVersion: nullText(row.agent_version),
      firstHeartbeatAt: nullInt(row.first_heartbeat_at),
      lastHeartbeatAt: nullInt(row.last_heartbeat_at),
    })),
  };
  const etag = weakEtag(body.agents.map((agent) => (
    `${agent.node}:${agent.tokenIssuedAt}:${agent.tokenRevokedAt ?? 0}:${agent.lastHeartbeatAt ?? 0}`
  )));
  return entityJson(e, req, body, etag, assertNodeAgents);
}

/**
 * `POST /api/v1/ops/nodes/{name}/agent-token` (nodes.publish, owner only).
 * Issues the node's heartbeat token, replacing any earlier one, and returns it
 * once. Only a salted hash is stored; the audit row lands in the same batch.
 * The old token's heartbeat is cleared, so the row shows nothing until the
 * new token reports.
 * Issuing a token lists nothing: the node's catalog membership is unchanged.
 */
export async function postNodeAgentToken(req: Request, e: Env, rawName: string, actor: Actor): Promise<Response> {
  const name = decodeName(rawName);
  const { profile } = await requireNode(e, name);
  if (profile && String(profile.status) === 'retired') {
    throw new ApiError(409, 'NODE_RETIRED', 'A retired node cannot get an agent token');
  }
  const minted = await mintNodeAgentToken();
  const t = now();
  await e.DB.batch([
    e.DB.prepare(
      `INSERT INTO ops_node_agents(node_name, token_id, token_salt, token_hash, token_issued_at)
       VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(node_name) DO UPDATE SET
         token_id = excluded.token_id,
         token_salt = excluded.token_salt,
         token_hash = excluded.token_hash,
         token_issued_at = excluded.token_issued_at,
         token_revoked_at = NULL,
         reported_ip = NULL,
         observed_ip = NULL,
         roles = NULL,
         agent_version = NULL,
         first_heartbeat_at = NULL,
         last_heartbeat_at = NULL`,
    ).bind(name, minted.tokenId, minted.salt, minted.hash, t),
    opsAuditStatement(
      e, actor.email, 'node.agent_token.issue', 'node', name,
      `issued node agent token ${minted.tokenId} for ${name}`, false, auditMeta(actor),
    ),
  ]);
  const dto: NodeAgentTokenDto = { node: name, token: minted.token, tokenIssuedAt: t };
  return jsonNoStore(dto, 201);
}

/**
 * `DELETE /api/v1/ops/nodes/{name}/agent-token` (nodes.publish): the token stops
 * working at once. The audit row is written only when a live token was revoked
 * (`changes() > 0`): an unknown node is a 404 and a repeat is an idempotent 200,
 * neither audited.
 */
export async function deleteNodeAgentToken(_req: Request, e: Env, rawName: string, actor: Actor): Promise<Response> {
  const name = decodeName(rawName);
  const t = now();
  // The receipt is read inside the same batch (one transaction) as the revoke.
  const [, , receipt] = await e.DB.batch([
    e.DB.prepare(
      'UPDATE ops_node_agents SET token_revoked_at = ? WHERE node_name = ? AND token_revoked_at IS NULL',
    ).bind(t, name),
    opsAuditStatement(
      e, actor.email, 'node.agent_token.revoke', 'node', name,
      `revoked node agent token for ${name}`, true, auditMeta(actor),
    ),
    e.DB.prepare('SELECT token_revoked_at FROM ops_node_agents WHERE node_name = ?').bind(name),
  ]);
  const row = (receipt?.results as Row[] | undefined)?.[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'This node has no agent token');
  return jsonNoStore({ node: name, tokenRevokedAt: Number(row.token_revoked_at) });
}
