import { ApiError } from '../../errors';
import { type Env } from '../../env';
import type { OpsRequestCache } from '../cache';
import {
  operationsNodeSelections,
  ACTIVITY_ONLINE_SECONDS,
} from '../reads';

export async function getOpsIncidentNode(e: Env, mt: RegExpMatchArray, opsCache: OpsRequestCache): Promise<Response> {
  const name = decodeURIComponent(mt[1]);
  if (!name || name.length > 200) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid node name');
  return Response.json({
    node: name,
    onlineWindowSeconds: ACTIVITY_ONLINE_SECONDS,
    affected: await operationsNodeSelections(e, name, opsCache),
  });
}
