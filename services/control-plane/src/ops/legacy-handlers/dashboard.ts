import { type Env } from '../../env';
import type { OpsRequestCache } from '../cache';
import { operationsDashboard } from '../reads';

export async function getOpsDashboard(e: Env, opsCache: OpsRequestCache): Promise<Response> {
  return Response.json({ dashboard: await operationsDashboard(e, opsCache) });
}
