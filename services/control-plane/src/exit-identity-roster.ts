import type { Env, Row } from './env';

// The exit agent recovers a lost local ledger from this field. It is the
// authenticated node's own `usage_report_sources.last_total_bytes`, not the
// account-wide sum: seeding from the sum makes every extra exit re-report the
// others' history. Absent on the legacy shared-token read, which has no node
// to scope a watermark to; old agents ignore the key.
export async function exitIdentityRosterResponse(
  e: Env,
  nodeId: string | undefined,
  observedAt: number,
  roster: { retireSharedLegacy: boolean; rows: Row[] },
): Promise<Response> {
  const watermarks = new Map<string, number>();
  if (nodeId) {
    const rows = await e.DB.prepare(
      `SELECT user_id, last_total_bytes
         FROM usage_report_sources
        WHERE source_id = ?`,
    ).bind(nodeId).all<Row>();
    for (const row of rows.results) {
      watermarks.set(String(row.user_id), Number(row.last_total_bytes));
    }
  }
  return Response.json({
    // New agents verify this before touching Xray or billing state. Existing
    // node source IDs are accounting identities and cannot be renamed without
    // an exactly-once ledger migration. Legacy dual-phase readers receive no
    // nodeId and old agents safely ignore this additive field.
    nodeId,
    // Echoed so a reconciling agent can tell a stale response from an empty
    // roster: applying an empty list as if it were current would disconnect
    // every account at once.
    observedAt,
    retireSharedLegacy: roster.retireSharedLegacy,
    // Removed identities can still have retained Xray counters. Their billing
    // recovery history must not depend on current traffic authorization.
    sourceUsageWatermarks: nodeId ? [...watermarks].map(([userId, sourceUsageBytes]) => ({
      userId, sourceUsageBytes,
    })) : undefined,
    identities: roster.rows.map((row) => {
      const userId = String(row.user_id);
      return {
        userId,
        deviceId: row.device_id ? String(row.device_id) : undefined,
        clientUUID: String(row.client_uuid),
        ...(nodeId ? { sourceUsageBytes: watermarks.get(userId) ?? 0 } : {}),
      };
    }),
  });
}
