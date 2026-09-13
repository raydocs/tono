// How much of today's picture was actually measured. Same tables/columns
// verdict-facts already reads; missing tables omit the field.

import { decryptCatalog } from '../crypto';
import { type Env, requiredCatalogKey } from '../env';
import { splitManagedCatalogProxies } from '../catalog-yaml';
import type { CoverageDto } from './contract';
import { loadOperationsLive } from './live';

const SWEEP_FRESH_SEC = 26 * 3600;
const AGENT_FRESH_SEC = 15 * 60;
const REPORT_FRESH_SEC = 40 * 60;

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

export async function coverageOf(e: Env, nowSec: number): Promise<CoverageDto | undefined> {
  try {
    const [catalog, live, customers] = await Promise.all([
      e.DB.prepare(
        'SELECT ciphertext, nonce FROM managed_exit_catalog WHERE singleton_id = 1',
      ).first<{ ciphertext: string; nonce: string }>(),
      loadOperationsLive(e),
      e.DB.prepare(
        `SELECT COUNT(*) AS n, SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS fresh
         FROM ops_customer_status`,
      ).bind(nowSec - REPORT_FRESH_SEC).first<{ n: number; fresh: number | null }>(),
    ]);
    let listed = new Set<string>();
    try {
      if (catalog) {
        const yaml = await decryptCatalog(String(catalog.ciphertext), String(catalog.nonce), requiredCatalogKey(e));
        listed = new Set(splitManagedCatalogProxies(yaml).items.map((item) => item.name));
      }
    } catch { /* catalog unread: listed stays empty */ }
    const sweepAt = live.quality?.updatedAt ?? live.qualityReceivedAt;
    const swept = sweepAt != null && nowSec - sweepAt <= SWEEP_FRESH_SEC
      ? new Set((live.quality?.nodes ?? []).map((node) => String(node.name)))
      : new Set<string>();
    const withAgent = new Set(
      (live.agents ?? [])
        .filter((node) => {
          const at = Number(node.observedAt);
          return Number.isFinite(at) && at > 0 && nowSec - at <= AGENT_FRESH_SEC;
        })
        .map((node) => String(node.name)),
    );
    return {
      nodesListed: listed.size,
      nodesSweptFresh: [...listed].filter((name) => swept.has(name)).length,
      nodesWithAgent: [...listed].filter((name) => withAgent.has(name)).length,
      customersActive: Number(customers?.n ?? 0),
      customersReportedFresh: Number(customers?.fresh ?? 0),
      asOfSec: nowSec,
    };
  } catch (error) {
    if (missingTable(error)) return undefined;
    throw error;
  }
}
