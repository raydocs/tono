// 节点自注册（A20，决策 D7-A）：节点持自己的 token 上报 IP、角色、版本、心跳。

import { arrayOf, enumList, fields, int, optInt, optText, text } from './checkers';

/** Services a node agent may say it runs. Anything else is refused at ingest. */
export const NODE_AGENT_ROLES = ['xray', 'hy2', 'relay'] as const;
export type NodeAgentRole = (typeof NODE_AGENT_ROLES)[number];

/**
 * One node's agent credential and its last heartbeat.
 *
 * `reportedIp` is what the node said; `observedIp` is the address Cloudflare
 * saw. Neither changes routing, the catalog or the node profile. A node whose
 * token was issued but never used has null heartbeat fields. `tokenRevokedAt`
 * is set once the token can no longer heartbeat.
 */
export interface NodeAgentDto {
  node: string;
  tokenIssuedAt: number;
  tokenRevokedAt: number | null;
  reportedIp: string | null;
  observedIp: string | null;
  roles: NodeAgentRole[];
  agentVersion: string | null;
  firstHeartbeatAt: number | null;
  lastHeartbeatAt: number | null;
}

export interface NodeAgentsDto {
  agents: NodeAgentDto[];
}

/** The only response that ever carries the token. Not stored, not cached. */
export interface NodeAgentTokenDto {
  node: string;
  token: string;
  tokenIssuedAt: number;
}

const AGENT_KEYS = [
  'node', 'tokenIssuedAt', 'tokenRevokedAt', 'reportedIp', 'observedIp', 'roles',
  'agentVersion', 'firstHeartbeatAt', 'lastHeartbeatAt',
] as const;

export function assertNodeAgent(value: unknown, path = 'nodeAgent'): NodeAgentDto {
  const row = fields(value, path, AGENT_KEYS);
  return {
    node: text(row, path, 'node'),
    tokenIssuedAt: int(row, path, 'tokenIssuedAt'),
    tokenRevokedAt: optInt(row, path, 'tokenRevokedAt'),
    reportedIp: optText(row, path, 'reportedIp'),
    observedIp: optText(row, path, 'observedIp'),
    roles: enumList(row, path, 'roles', NODE_AGENT_ROLES),
    agentVersion: optText(row, path, 'agentVersion'),
    firstHeartbeatAt: optInt(row, path, 'firstHeartbeatAt'),
    lastHeartbeatAt: optInt(row, path, 'lastHeartbeatAt'),
  };
}

export function assertNodeAgents(value: unknown, path = 'nodeAgents'): NodeAgentsDto {
  const row = fields(value, path, ['agents']);
  return { agents: arrayOf(row, path, 'agents', assertNodeAgent) };
}
