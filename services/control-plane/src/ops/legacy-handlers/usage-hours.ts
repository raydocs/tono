import { queryUserUsageHours } from '../../ops-usage-hours';
import { ApiError } from '../../errors';
import {
  type Env,
  now,
} from '../../env';

export async function getOpsUsageHours(req: Request, e: Env): Promise<Response> {
  const url = new URL(req.url);
  const range = url.searchParams.get('range');
  const hours = range === '7d' ? 24 * 7 : range === '90d' ? 24 * 90 : 24;
  if (range !== null && !['24h', '7d', '90d'].includes(range)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Unsupported usage-hours range');
  }
  return Response.json({
    usageHours: await queryUserUsageHours(e.DB, now(), hours),
  });
}
