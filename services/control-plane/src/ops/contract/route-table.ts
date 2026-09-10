// GET /api/v1/ops/* → the assert* that must accept the response.
//
// The console and the capture script both need this map: one side walks a
// wrangler origin, the other re-runs the same checkers over committed JSON.
// Keeping the names here (not in either test file) is what lets a new GET
// route fail CI for missing a checker rather than shipping an unchecked
// envelope.

import type { SourceId } from './vocabulary';
import { SOURCE_IDS } from './vocabulary';
import {
  assertList,
  fields,
  measuredArray,
  oneOf,
  optInt,
  violation,
} from './checkers';
import {
  assertNodeBindings,
  assertNodeDetail,
  assertNodeErrorRow,
  assertNodeHistoryEntry,
  assertNodeSummary,
} from './nodes';
import {
  assertActivityHour,
  assertConnectionEvent,
  assertCustomerDetail,
  assertCustomerSummary,
  assertDestinationRow,
  assertServiceUsage,
} from './customers';
import {
  assertAdoptionMatrix,
  assertAlertDelivery,
  assertAlertRule,
  assertIncident,
  assertIncidentDetail,
  assertJob,
  assertRelease,
} from './operations';
import { assertDigest, assertFollowupList } from './followups';
import {
  assertAuditList,
  assertDirectCandidate,
  assertHomeLine,
  assertHomeLineUsageDay,
  assertProviderAccount,
  assertSystemHealth,
} from './assets';
import { assertFxRate, assertLedgerEntryList, assertMonthSummary } from './ledger';

export const assertNodeSummaryList = (value: unknown) => assertList(value, assertNodeSummary);
export const assertNodeHistoryList = (value: unknown) => assertList(value, assertNodeHistoryEntry);
export const assertNodeConnectionsList = (value: unknown) => assertList(value, assertConnectionEvent);
export const assertNodeJobsList = (value: unknown) => assertList(value, assertJob);
export const assertCustomerSummaryList = (value: unknown) => assertList(value, assertCustomerSummary);
export const assertCustomerConnectionsList = (value: unknown) => assertList(value, assertConnectionEvent);
export const assertCustomerActivityList = (value: unknown) => assertList(value, assertActivityHour);
export const assertCustomerDestinationsList = (value: unknown) => assertList(value, assertDestinationRow);
export const assertCustomerServicesList = (value: unknown) => assertList(value, assertServiceUsage);
export const assertIncidentList = (value: unknown) => assertList(value, assertIncident);
export const assertJobList = (value: unknown) => assertList(value, assertJob);
export const assertReleaseList = (value: unknown) => assertList(value, assertRelease);
export const assertDirectCandidateList = (value: unknown) => assertList(value, assertDirectCandidate);
export const assertProviderAccountList = (value: unknown) => assertList(value, assertProviderAccount);
export const assertHomeLineList = (value: unknown) => assertList(value, assertHomeLine);
export const assertHomeLineUsageList = (value: unknown) => assertList(value, assertHomeLineUsageDay);
export const assertAlertRuleList = (value: unknown) => assertList(value, assertAlertRule);
export const assertAlertDeliveryList = (value: unknown) => assertList(value, assertAlertDelivery);

/** `GET nodes/{name}/errors` is a Measured array, not the list envelope. */
export function assertNodeErrorsMeasured(value: unknown) {
  const path = 'nodeErrors';
  const row = fields(value, path, ['value', 'asOfSec', 'source']);
  const asOfSec = optInt(row, path, 'asOfSec');
  if (asOfSec !== null && asOfSec <= 0) violation(`${path}.asOfSec`);
  return {
    value: measuredArray(assertNodeErrorRow)(row.value, `${path}.value`),
    asOfSec,
    source: oneOf<SourceId>(row, path, 'source', SOURCE_IDS),
  };
}

export const NAMED_CHECKERS = {
  assertNodeSummaryList,
  assertNodeDetail,
  assertNodeHistoryList,
  assertNodeConnectionsList,
  assertNodeErrorsMeasured,
  assertNodeBindings,
  assertNodeJobsList,
  assertCustomerSummaryList,
  assertCustomerDetail,
  assertCustomerConnectionsList,
  assertCustomerActivityList,
  assertCustomerDestinationsList,
  assertCustomerServicesList,
  assertIncidentList,
  assertIncidentDetail,
  assertFollowupList,
  assertDigest,
  assertJobList,
  assertReleaseList,
  assertAdoptionMatrix,
  assertDirectCandidateList,
  assertProviderAccountList,
  assertProviderAccount,
  assertHomeLineList,
  assertHomeLine,
  assertHomeLineUsageList,
  assertAlertRuleList,
  assertAlertRule,
  assertAlertDeliveryList,
  assertAuditList,
  assertSystemHealth,
  assertLedgerEntryList,
  assertMonthSummary,
  assertFxRate,
} as const;

export const CHECKER_BY_NAME = NAMED_CHECKERS;

export type CheckerName = keyof typeof NAMED_CHECKERS;

export interface GetRouteBinding {
  route: string;
  checker: CheckerName;
}

/**
 * One row per JSON GET in `OPS_V1_ROUTES`. CSV downloads are listed on the
 * dispatch table but not here — they are not a DTO. The coverage test
 * compares this list to the JSON GET routes so a new read cannot ship
 * without a checker, and a leftover checker cannot sit on a route that
 * no longer exists.
 */
export const GET_ROUTE_TABLE: readonly GetRouteBinding[] = [
  { route: 'GET /api/v1/ops/nodes', checker: 'assertNodeSummaryList' },
  { route: 'GET /api/v1/ops/nodes/{name}', checker: 'assertNodeDetail' },
  { route: 'GET /api/v1/ops/nodes/{name}/history', checker: 'assertNodeHistoryList' },
  { route: 'GET /api/v1/ops/nodes/{name}/connections', checker: 'assertNodeConnectionsList' },
  { route: 'GET /api/v1/ops/nodes/{name}/errors', checker: 'assertNodeErrorsMeasured' },
  { route: 'GET /api/v1/ops/nodes/{name}/bindings', checker: 'assertNodeBindings' },
  { route: 'GET /api/v1/ops/nodes/{name}/jobs', checker: 'assertNodeJobsList' },
  { route: 'GET /api/v1/ops/customers', checker: 'assertCustomerSummaryList' },
  { route: 'GET /api/v1/ops/customers/{id}', checker: 'assertCustomerDetail' },
  { route: 'GET /api/v1/ops/customers/{id}/connections', checker: 'assertCustomerConnectionsList' },
  { route: 'GET /api/v1/ops/customers/{id}/activity', checker: 'assertCustomerActivityList' },
  { route: 'GET /api/v1/ops/customers/{id}/destinations', checker: 'assertCustomerDestinationsList' },
  { route: 'GET /api/v1/ops/customers/{id}/services', checker: 'assertCustomerServicesList' },
  { route: 'GET /api/v1/ops/customers/{id}/followups', checker: 'assertFollowupList' },
  { route: 'GET /api/v1/ops/incidents', checker: 'assertIncidentList' },
  { route: 'GET /api/v1/ops/incidents/{id}', checker: 'assertIncidentDetail' },
  { route: 'GET /api/v1/ops/jobs', checker: 'assertJobList' },
  { route: 'GET /api/v1/ops/releases', checker: 'assertReleaseList' },
  { route: 'GET /api/v1/ops/releases/adoption', checker: 'assertAdoptionMatrix' },
  { route: 'GET /api/v1/ops/direct-candidates', checker: 'assertDirectCandidateList' },
  { route: 'GET /api/v1/ops/provider-accounts', checker: 'assertProviderAccountList' },
  { route: 'GET /api/v1/ops/provider-accounts/{id}', checker: 'assertProviderAccount' },
  { route: 'GET /api/v1/ops/home-lines', checker: 'assertHomeLineList' },
  { route: 'GET /api/v1/ops/home-lines/{id}', checker: 'assertHomeLine' },
  { route: 'GET /api/v1/ops/home-lines/{id}/usage', checker: 'assertHomeLineUsageList' },
  { route: 'GET /api/v1/ops/alert-rules', checker: 'assertAlertRuleList' },
  { route: 'GET /api/v1/ops/alert-rules/{id}', checker: 'assertAlertRule' },
  { route: 'GET /api/v1/ops/alert-deliveries', checker: 'assertAlertDeliveryList' },
  { route: 'GET /api/v1/ops/audit', checker: 'assertAuditList' },
  { route: 'GET /api/v1/ops/system/health', checker: 'assertSystemHealth' },
  { route: 'GET /api/v1/ops/followups', checker: 'assertFollowupList' },
  { route: 'GET /api/v1/ops/digest', checker: 'assertDigest' },
  { route: 'GET /api/v1/ops/ledger', checker: 'assertLedgerEntryList' },
  { route: 'GET /api/v1/ops/months/{month}', checker: 'assertMonthSummary' },
  { route: 'GET /api/v1/ops/fx', checker: 'assertFxRate' },
];

/** `<out>/<route-with-slashes-as-dashes>.json`, braces stripped so `{name}` is `name`. */
export function fixtureFileForRoute(route: string): string {
  const path = route.replace(/^GET \/api\/v1\/ops\//, '');
  return `${path.replace(/[{}]/g, '').replaceAll('/', '-')}.json`;
}

export function checkerForRoute(route: string): ((value: unknown) => unknown) | undefined {
  const binding = GET_ROUTE_TABLE.find((row) => row.route === route);
  return binding ? NAMED_CHECKERS[binding.checker] : undefined;
}
