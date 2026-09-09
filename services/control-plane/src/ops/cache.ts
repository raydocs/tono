import type { loadOperationsLive } from './live';
import type { loadOperationsActivity } from './reads';

// One ops request often wants the same snapshot several times over — the
// dashboard builds the fleet, the fleet joins activity, activity joins the
// quality report — and each used to re-read and re-parse the stored JSON.
// A cache object created per request deduplicates the work; the promise is
// stored so concurrent callers share one read instead of racing.
export type OpsRequestCache = {
  live?: ReturnType<typeof loadOperationsLive>;
  activity?: ReturnType<typeof loadOperationsActivity>;
};
