import {
  isMetricField,
  queryAgentMetrics,
} from '../../ops-timeseries';
import { ApiError } from '../../errors';
import {
  type Env,
  now,
} from '../../env';

export async function getOpsMetrics(req: Request, e: Env): Promise<Response> {
  const url = new URL(req.url);
  const range = url.searchParams.get('range');
  if (range !== null && !['24h', '7d', '90d'].includes(range)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Unsupported metrics range');
  }
  const rawFields = url.searchParams.get('fields');
  let fields: string[] | null = null;
  if (rawFields !== null) {
    fields = rawFields.split(',').map((field) => field.trim()).filter(Boolean);
    if (fields.length === 0 || !fields.every(isMetricField)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Unsupported metrics field');
    }
  }
  return Response.json({
    metrics: await queryAgentMetrics(e.DB, {
      range,
      node: url.searchParams.get('node'),
      nowUnix: now(),
      fields,
    }),
  });
}
