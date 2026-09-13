import { type Env } from '../../env';
import type { OpsRequestCache } from '../cache';
import { operationsActivity } from '../reads';

export async function getOpsActivity(e: Env, opsCache: OpsRequestCache): Promise<Response> {
  return Response.json({ activity: await operationsActivity(e, opsCache) });
}
