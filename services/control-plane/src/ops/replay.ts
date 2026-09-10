// Re-run current node rules on a history row's evidence snapshot.
// No I/O in replayHistoryRow; the handler loads the 2000-row window.

import type { ReplayDto, ReplayRowDto } from './contract';
import {
  NODE_VERDICTS,
  VERDICT_RULES_VERSION,
  nodeKind,
  nodeSeverity,
  observedVerdict,
  type CarrierMap,
  type NodeFails30m,
  type NodeVerdict,
  type NodeVerdictInput,
} from './verdict';

const CAP = 2000;
const CARRIER_KEYS = ['unicom', 'telecom', 'mobile'] as const;

type HistoryRow = {
  id: string;
  node_name: string;
  at: number;
  to_verdict: string;
  evidence_json: string | null;
};

function finite(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null;
}

function parseEvidence(raw: string | null): Record<string, unknown> | null {
  if (raw == null || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    // clipJson overflow stub — not a facts snapshot.
    if (row.truncated === true) return null;
    return row;
  } catch {
    return null;
  }
}

function carriersFromEvidence(evidence: Record<string, unknown>): CarrierMap | null {
  const raw = evidence.carriers;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const src = raw as Record<string, unknown>;
    const out: CarrierMap = {};
    for (const key of CARRIER_KEYS) {
      const row = src[key];
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const sample = row as Record<string, unknown>;
      out[key] = {
        lossPct: finite(sample.lossPct),
        latencyMs: finite(sample.latencyMs),
        samples: finite(sample.samples) ?? 0,
      };
    }
    if (Object.keys(out).length) return out;
  }
  const loss = evidence.loss;
  if (!Array.isArray(loss)) return null;
  const out: CarrierMap = {};
  for (const entry of loss) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const key = row.key;
    if (key !== 'unicom' && key !== 'telecom' && key !== 'mobile') continue;
    const lossPct = finite(row.lossPct);
    if (lossPct == null) continue;
    out[key] = { lossPct, latencyMs: null, samples: 1 };
  }
  return Object.keys(out).length ? out : null;
}

function machineFromEvidence(value: unknown): NodeVerdictInput['machine'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const cpu = finite(row.cpu);
  const memRatio = finite(row.memRatio);
  const diskRatio = finite(row.diskRatio);
  const load1 = finite(row.load1);
  if (cpu == null && memRatio == null && diskRatio == null && load1 == null) return null;
  return { cpu, memRatio, diskRatio, load1 };
}

function failsFromEvidence(evidence: Record<string, unknown>): NodeFails30m {
  const raw = evidence.fails30m;
  const base = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const topHandshake = finite(evidence.handshakeDistinctUsers);
  return {
    attempts: finite(base.attempts) ?? 0,
    failures: finite(base.failures) ?? 0,
    distinctUsers: finite(base.distinctUsers) ?? 0,
    handshakeDistinctUsers: topHandshake ?? finite(base.handshakeDistinctUsers) ?? 0,
  };
}

export function replayHistoryRow(input: {
  at: number;
  node: string;
  toVerdict: string;
  evidenceJson: string | null;
}): ReplayRowDto | null {
  if (!(NODE_VERDICTS as readonly string[]).includes(input.toVerdict)) return null;
  const wasVerdict = input.toVerdict as NodeVerdict;
  const evidence = parseEvidence(input.evidenceJson);
  if (!evidence) return null;
  const facts: NodeVerdictInput = {
    name: input.node,
    catalogListed: asBool(evidence.catalogListed),
    ok: asBool(evidence.ok),
    blockStatus: asText(evidence.blockStatus),
    agentObservedAt: finite(evidence.agentObservedAt),
    carriers: carriersFromEvidence(evidence),
    machine: machineFromEvidence(evidence.machine),
    occupancy: finite(evidence.occupancy),
    profileStatus: asText(evidence.profileStatus),
    prior: null,
    fails30m: failsFromEvidence(evidence),
    lastCustomerOkAt: finite(evidence.lastCustomerOkAt),
    errorSpike: evidence.errorSpike === true,
  };
  // Snapshot times = row.at so the stale-sweep gate does not paint historical ok as unknown.
  const nowVerdict = observedVerdict(facts, {
    nowSec: input.at,
    qualitySweepAt: input.at,
    agentsSnapshotAt: input.at,
  });
  return {
    at: input.at,
    node: input.node,
    wasVerdict,
    nowVerdict,
    wouldOpenKind: nodeKind(nowVerdict),
    wouldOpenSeverity: nodeSeverity(nowVerdict),
    differs: wasVerdict !== nowVerdict,
  };
}

export async function replay(
  db: D1Database,
  args: { since: number; until: number; node?: string },
  nowSec: number,
): Promise<ReplayDto> {
  let rows: HistoryRow[] = [];
  try {
    const named = args.node != null && args.node !== '';
    const sql = `SELECT id, node_name, at, to_verdict, evidence_json
       FROM ops_node_status_history
       WHERE at >= ? AND at <= ?${named ? ' AND node_name = ?' : ''}
       ORDER BY at ASC, id ASC
       LIMIT ?`;
    const stmt = named
      ? db.prepare(sql).bind(args.since, args.until, args.node, CAP)
      : db.prepare(sql).bind(args.since, args.until, CAP);
    rows = (await stmt.all<HistoryRow>()).results ?? [];
  } catch (error) {
    if (!String(error).includes('no such table')) throw error;
  }
  const items: ReplayRowDto[] = [];
  let skipped = 0;
  for (const row of rows) {
    const replayed = replayHistoryRow({
      at: Number(row.at),
      node: String(row.node_name),
      toVerdict: String(row.to_verdict),
      evidenceJson: row.evidence_json == null ? null : String(row.evidence_json),
    });
    if (!replayed) {
      skipped += 1;
      continue;
    }
    items.push(replayed);
  }
  return {
    rulesVersion: VERDICT_RULES_VERSION,
    items,
    skipped,
    updatedAt: nowSec,
  };
}
