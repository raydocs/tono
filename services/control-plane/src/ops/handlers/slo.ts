import type { Env } from '../../env';
import { assertSloResponse, type SloResponseDto, type SloRowDto, type SloSummaryDto } from '../contract';
import {
  entityJson,
  missingTable,
  now,
  weakEtag,
} from './common';

export async function getSlo(req: Request, e: Env): Promise<Response> {
  const url = new URL(req.url);
  const rangeParam = url.searchParams.get('range');
  const days = rangeParam === '7d' ? 7 : 30;
  const platform = url.searchParams.get('platform')?.trim() || null;
  const carrier = url.searchParams.get('carrier')?.trim() || null;
  const node = url.searchParams.get('node')?.trim() || null;

  const t = now();
  const dayStart = Math.floor(t / 86_400) * 86_400;
  const sinceSec = dayStart - days * 86_400;

  try {
    let sql = 'SELECT day_at, platform, carrier, node, attempts, successes, p50_ms, verified_outage_min, unmeasured_min, rules_version FROM ops_daily_slo WHERE day_at >= ?';
    const params: unknown[] = [sinceSec];

    if (platform) {
      sql += ' AND platform = ?';
      params.push(platform);
    }
    if (carrier) {
      sql += ' AND carrier = ?';
      params.push(carrier);
    }
    if (node) {
      sql += ' AND node = ?';
      params.push(node);
    }
    sql += ' ORDER BY day_at DESC, node ASC, platform ASC, carrier ASC';

    const stmt = e.DB.prepare(sql);
    const rows = await stmt.bind(...params).all<{
      day_at: number;
      platform: string;
      carrier: string;
      node: string;
      attempts: number;
      successes: number;
      p50_ms: number | null;
      verified_outage_min: number;
      unmeasured_min: number;
      rules_version: number;
    }>();

    const items: SloRowDto[] = (rows.results ?? []).map((r) => ({
      dayAt: Number(r.day_at),
      platform: String(r.platform),
      carrier: String(r.carrier),
      node: String(r.node),
      attempts: Number(r.attempts),
      successes: Number(r.successes),
      p50Ms: r.p50_ms != null ? Number(r.p50_ms) : null,
      verifiedOutageMin: Number(r.verified_outage_min),
      unmeasuredMin: Number(r.unmeasured_min),
      rulesVersion: Number(r.rules_version),
    }));

    const totalAttempts = items.reduce((sum, item) => sum + item.attempts, 0);
    const totalSuccesses = items.reduce((sum, item) => sum + item.successes, 0);
    const successRate = totalAttempts > 0 ? Number((totalSuccesses / totalAttempts).toFixed(4)) : null;

    const p50Values = items
      .map((item) => item.p50Ms)
      .filter((p): p is number => p != null && Number.isFinite(p))
      .sort((a, b) => a - b);
    const p50Ms = p50Values.length > 0 ? p50Values[Math.floor((p50Values.length - 1) / 2)] : null;

    const nodeDayOutage = new Map<string, number>();
    const nodeDayUnmeasured = new Map<string, number>();

    for (const item of items) {
      const key = `${item.dayAt}:${item.node}`;
      if (!nodeDayOutage.has(key)) {
        nodeDayOutage.set(key, item.verifiedOutageMin);
      }
      if (!nodeDayUnmeasured.has(key)) {
        nodeDayUnmeasured.set(key, item.unmeasuredMin);
      }
    }

    const verifiedOutageMin = [...nodeDayOutage.values()].reduce((sum, m) => sum + m, 0);
    const unmeasuredMin = [...nodeDayUnmeasured.values()].reduce((sum, m) => sum + m, 0);

    const distinctDaysCount = nodeDayUnmeasured.size;
    const totalTrackedMinutes = distinctDaysCount * 1440;
    const measuredMinutes = Math.max(0, totalTrackedMinutes - unmeasuredMin);
    const coverage = totalTrackedMinutes > 0
      ? Number((measuredMinutes / totalTrackedMinutes).toFixed(4))
      : 1;

    const summary: SloSummaryDto = {
      successRate,
      p50Ms,
      verifiedOutageMin,
      unmeasuredMin,
      coverage,
    };

    const envelope: SloResponseDto = {
      items,
      summary,
      nextCursor: null,
      total: items.length,
      updatedAt: t,
    };

    const etag = weakEtag([t, days, platform ?? '', carrier ?? '', node ?? '', items.length]);
    return entityJson(e, req, envelope, etag, assertSloResponse);
  } catch (error) {
    if (missingTable(error)) {
      const emptyEnvelope: SloResponseDto = {
        items: [],
        summary: {
          successRate: null,
          p50Ms: null,
          verifiedOutageMin: 0,
          unmeasuredMin: 0,
          coverage: 1,
        },
        nextCursor: null,
        total: 0,
        updatedAt: t,
      };
      return entityJson(e, req, emptyEnvelope, weakEtag([t, 0]), assertSloResponse);
    }
    throw error;
  }
}
