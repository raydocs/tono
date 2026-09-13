import { type Env } from '../../env';
import { operationsLive } from '../live';
import type { OpsRequestCache } from '../cache';

export async function getOpsLive(e: Env, opsCache: OpsRequestCache): Promise<Response> {
  return Response.json({ live: await operationsLive(e, opsCache) });
}
