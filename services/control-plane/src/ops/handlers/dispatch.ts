import type { Env } from '../../env';
import {
  getNodes, getNode, getNodeBindings, getNodeHistory, getNodeConnections,
  getNodeErrors, getNodeJobs, postNodeJob, patchNodeProfile,
} from './nodes';
import { getNodeRetirePreview } from '../retire-dependencies';
import {
  getCustomers, getCustomer, getCustomerConnections, getCustomerActivity,
  getCustomerDestinations, getCustomerServices,
} from './customers';
import {
  getIncidents, getIncident, postIncidentAck, postIncidentSnooze,
  postIncidentResolve, postIncidentNotes, patchIncident,
} from './incidents';
import {
  getCustomerFollowups, postCustomerFollowup, postIncidentFollowup,
  patchFollowup, getFollowups, getDigest,
} from './followups';
import { getJobs, postJobCancel } from './jobs';
import { getReleases, postRelease, patchRelease, getReleaseAdoption } from './releases';
import {
  getDirectCandidates, postCandidateAccept, postCandidateReject, postDraftFromCandidates,
} from './candidates';
import {
  getProviderAccounts, getProviderAccountOne, postProviderAccount, patchProviderAccount,
  deleteProviderAccount, getHomeLines, getHomeLine, postHomeLine, patchHomeLineRoute,
  deleteHomeLine, getHomeLineUsage,
} from './assets';
import {
  getAlertRules, getAlertRule, postAlertRule, patchAlertRule, deleteAlertRule,
  postAlertRuleTest, getAlertDeliveries,
} from './alerts';
import { getSystemHealth } from './system';
import {
  getFx, getLedger, getMonth, getMonthExport, patchLedger, postLedger, postLedgerReverse, postMonthClose,
} from './ledger';
import type { Actor } from './common';

export const OPS_V1_ROUTES = [
  'GET /api/v1/ops/nodes',
  'GET /api/v1/ops/nodes/{name}',
  'GET /api/v1/ops/nodes/{name}/history',
  'GET /api/v1/ops/nodes/{name}/connections',
  'GET /api/v1/ops/nodes/{name}/errors',
  'GET /api/v1/ops/nodes/{name}/bindings',
  'GET /api/v1/ops/nodes/{name}/jobs',
  'GET /api/v1/ops/nodes/{name}/retire-preview',
  'POST /api/v1/ops/nodes/{name}/jobs',
  'PATCH /api/v1/ops/nodes/{name}/profile',
  'GET /api/v1/ops/customers',
  'GET /api/v1/ops/customers/{id}',
  'GET /api/v1/ops/customers/{id}/connections',
  'GET /api/v1/ops/customers/{id}/activity',
  'GET /api/v1/ops/customers/{id}/destinations',
  'GET /api/v1/ops/customers/{id}/services',
  'GET /api/v1/ops/customers/{id}/followups',
  'POST /api/v1/ops/customers/{id}/followups',
  'GET /api/v1/ops/incidents',
  'GET /api/v1/ops/incidents/{id}',
  'POST /api/v1/ops/incidents/{id}/ack',
  'POST /api/v1/ops/incidents/{id}/snooze',
  'POST /api/v1/ops/incidents/{id}/resolve',
  'POST /api/v1/ops/incidents/{id}/notes',
  'POST /api/v1/ops/incidents/{id}/followups',
  'PATCH /api/v1/ops/incidents/{id}',
  'GET /api/v1/ops/followups',
  'PATCH /api/v1/ops/followups/{id}',
  'GET /api/v1/ops/digest',
  'GET /api/v1/ops/jobs',
  'POST /api/v1/ops/jobs/{id}/cancel',
  'GET /api/v1/ops/releases',
  'POST /api/v1/ops/releases',
  'PATCH /api/v1/ops/releases/{id}',
  'GET /api/v1/ops/releases/adoption',
  'GET /api/v1/ops/direct-candidates',
  'POST /api/v1/ops/direct-candidates/{etld1}/accept',
  'POST /api/v1/ops/direct-candidates/{etld1}/reject',
  'POST /api/v1/ops/traffic-policy/draft-from-candidates',
  'GET /api/v1/ops/provider-accounts',
  'POST /api/v1/ops/provider-accounts',
  'GET /api/v1/ops/provider-accounts/{id}',
  'PATCH /api/v1/ops/provider-accounts/{id}',
  'DELETE /api/v1/ops/provider-accounts/{id}',
  'GET /api/v1/ops/home-lines',
  'POST /api/v1/ops/home-lines',
  'GET /api/v1/ops/home-lines/{id}',
  'PATCH /api/v1/ops/home-lines/{id}',
  'DELETE /api/v1/ops/home-lines/{id}',
  'GET /api/v1/ops/home-lines/{id}/usage',
  'GET /api/v1/ops/alert-rules',
  'POST /api/v1/ops/alert-rules',
  'GET /api/v1/ops/alert-rules/{id}',
  'PATCH /api/v1/ops/alert-rules/{id}',
  'DELETE /api/v1/ops/alert-rules/{id}',
  'POST /api/v1/ops/alert-rules/{id}/test',
  'GET /api/v1/ops/alert-deliveries',
  'GET /api/v1/ops/audit',
  'GET /api/v1/ops/system/health',
  'GET /api/v1/ops/ledger',
  'POST /api/v1/ops/ledger',
  'PATCH /api/v1/ops/ledger/{id}',
  'POST /api/v1/ops/ledger/{id}/reverse',
  'GET /api/v1/ops/months/{month}',
  'POST /api/v1/ops/months/{month}/close',
  'GET /api/v1/ops/months/{month}/export.csv',
  'GET /api/v1/ops/fx',
] as const;

type Handler = (req: Request, e: Env, actor: Actor, params: string[]) => Promise<Response>;

const ROUTES: Array<{ method: string; re: RegExp; handle: Handler }> = [
  { method: 'GET', re: /^\/api\/v1\/ops\/nodes$/, handle: (req, e) => getNodes(req, e) },
  { method: 'GET', re: /^\/api\/v1\/ops\/nodes\/([^/]+)\/history$/, handle: (req, e, _a, p) => getNodeHistory(req, e, p[0]) },
  { method: 'GET', re: /^\/api\/v1\/ops\/nodes\/([^/]+)\/connections$/, handle: (req, e, _a, p) => getNodeConnections(req, e, p[0]) },
  { method: 'GET', re: /^\/api\/v1\/ops\/nodes\/([^/]+)\/errors$/, handle: (req, e, _a, p) => getNodeErrors(req, e, p[0]) },
  { method: 'GET', re: /^\/api\/v1\/ops\/nodes\/([^/]+)\/bindings$/, handle: (req, e, _a, p) => getNodeBindings(req, e, p[0]) },
  { method: 'GET', re: /^\/api\/v1\/ops\/nodes\/([^/]+)\/jobs$/, handle: (req, e, _a, p) => getNodeJobs(req, e, p[0]) },
  { method: 'GET', re: /^\/api\/v1\/ops\/nodes\/([^/]+)\/retire-preview$/, handle: (req, e, _a, p) => getNodeRetirePreview(req, e, p[0]) },
  { method: 'POST', re: /^\/api\/v1\/ops\/nodes\/([^/]+)\/jobs$/, handle: (req, e, a, p) => postNodeJob(req, e, p[0], a) },
  { method: 'PATCH', re: /^\/api\/v1\/ops\/nodes\/([^/]+)\/profile$/, handle: (req, e, a, p) => patchNodeProfile(req, e, p[0], a) },
  { method: 'GET', re: /^\/api\/v1\/ops\/nodes\/([^/]+)$/, handle: (req, e, _a, p) => getNode(req, e, p[0]) },
  { method: 'GET', re: /^\/api\/v1\/ops\/customers$/, handle: (req, e) => getCustomers(req, e) },
  { method: 'GET', re: /^\/api\/v1\/ops\/customers\/([^/]+)\/connections$/, handle: (req, e, _a, p) => getCustomerConnections(req, e, p[0]) },
  { method: 'GET', re: /^\/api\/v1\/ops\/customers\/([^/]+)\/activity$/, handle: (req, e, _a, p) => getCustomerActivity(req, e, p[0]) },
  { method: 'GET', re: /^\/api\/v1\/ops\/customers\/([^/]+)\/destinations$/, handle: (req, e, _a, p) => getCustomerDestinations(req, e, p[0]) },
  { method: 'GET', re: /^\/api\/v1\/ops\/customers\/([^/]+)\/services$/, handle: (req, e, _a, p) => getCustomerServices(req, e, p[0]) },
  { method: 'GET', re: /^\/api\/v1\/ops\/customers\/([^/]+)\/followups$/, handle: (req, e, _a, p) => getCustomerFollowups(req, e, p[0]) },
  { method: 'POST', re: /^\/api\/v1\/ops\/customers\/([^/]+)\/followups$/, handle: (req, e, a, p) => postCustomerFollowup(req, e, p[0], a) },
  { method: 'GET', re: /^\/api\/v1\/ops\/customers\/([^/]+)$/, handle: (req, e, _a, p) => getCustomer(req, e, p[0]) },
  { method: 'GET', re: /^\/api\/v1\/ops\/incidents$/, handle: (req, e) => getIncidents(req, e) },
  { method: 'POST', re: /^\/api\/v1\/ops\/incidents\/([^/]+)\/ack$/, handle: (req, e, a, p) => postIncidentAck(req, e, p[0], a) },
  { method: 'POST', re: /^\/api\/v1\/ops\/incidents\/([^/]+)\/snooze$/, handle: (req, e, a, p) => postIncidentSnooze(req, e, p[0], a) },
  { method: 'POST', re: /^\/api\/v1\/ops\/incidents\/([^/]+)\/resolve$/, handle: (req, e, a, p) => postIncidentResolve(req, e, p[0], a) },
  { method: 'POST', re: /^\/api\/v1\/ops\/incidents\/([^/]+)\/notes$/, handle: (req, e, a, p) => postIncidentNotes(req, e, p[0], a) },
  { method: 'POST', re: /^\/api\/v1\/ops\/incidents\/([^/]+)\/followups$/, handle: (req, e, a, p) => postIncidentFollowup(req, e, p[0], a) },
  { method: 'PATCH', re: /^\/api\/v1\/ops\/incidents\/([^/]+)$/, handle: (req, e, a, p) => patchIncident(req, e, p[0], a) },
  { method: 'GET', re: /^\/api\/v1\/ops\/incidents\/([^/]+)$/, handle: (req, e, _a, p) => getIncident(req, e, p[0]) },
  { method: 'GET', re: /^\/api\/v1\/ops\/followups$/, handle: (req, e) => getFollowups(req, e) },
  { method: 'PATCH', re: /^\/api\/v1\/ops\/followups\/([^/]+)$/, handle: (req, e, a, p) => patchFollowup(req, e, p[0], a) },
  { method: 'GET', re: /^\/api\/v1\/ops\/digest$/, handle: (req, e) => getDigest(req, e) },
  { method: 'GET', re: /^\/api\/v1\/ops\/jobs$/, handle: (req, e) => getJobs(req, e) },
  { method: 'POST', re: /^\/api\/v1\/ops\/jobs\/([^/]+)\/cancel$/, handle: (req, e, a, p) => postJobCancel(req, e, p[0], a) },
  { method: 'GET', re: /^\/api\/v1\/ops\/releases\/adoption$/, handle: (req, e) => getReleaseAdoption(req, e) },
  { method: 'GET', re: /^\/api\/v1\/ops\/releases$/, handle: (req, e) => getReleases(req, e) },
  { method: 'POST', re: /^\/api\/v1\/ops\/releases$/, handle: (req, e, a) => postRelease(req, e, a) },
  { method: 'PATCH', re: /^\/api\/v1\/ops\/releases\/([^/]+)$/, handle: (req, e, a, p) => patchRelease(req, e, p[0], a) },
  { method: 'GET', re: /^\/api\/v1\/ops\/direct-candidates$/, handle: (req, e) => getDirectCandidates(req, e) },
  { method: 'POST', re: /^\/api\/v1\/ops\/direct-candidates\/([^/]+)\/accept$/, handle: (req, e, a, p) => postCandidateAccept(req, e, p[0], a) },
  { method: 'POST', re: /^\/api\/v1\/ops\/direct-candidates\/([^/]+)\/reject$/, handle: (req, e, a, p) => postCandidateReject(req, e, p[0], a) },
  { method: 'POST', re: /^\/api\/v1\/ops\/traffic-policy\/draft-from-candidates$/, handle: (req, e, a) => postDraftFromCandidates(req, e, a) },
  { method: 'GET', re: /^\/api\/v1\/ops\/provider-accounts$/, handle: (req, e) => getProviderAccounts(req, e) },
  { method: 'POST', re: /^\/api\/v1\/ops\/provider-accounts$/, handle: (req, e, a) => postProviderAccount(req, e, a) },
  { method: 'GET', re: /^\/api\/v1\/ops\/provider-accounts\/([^/]+)$/, handle: (req, e, _a, p) => getProviderAccountOne(req, e, p[0]) },
  { method: 'PATCH', re: /^\/api\/v1\/ops\/provider-accounts\/([^/]+)$/, handle: (req, e, a, p) => patchProviderAccount(req, e, p[0], a) },
  { method: 'DELETE', re: /^\/api\/v1\/ops\/provider-accounts\/([^/]+)$/, handle: (req, e, a, p) => deleteProviderAccount(req, e, p[0], a) },
  { method: 'GET', re: /^\/api\/v1\/ops\/home-lines\/([^/]+)\/usage$/, handle: (req, e, _a, p) => getHomeLineUsage(req, e, p[0]) },
  { method: 'GET', re: /^\/api\/v1\/ops\/home-lines$/, handle: (req, e) => getHomeLines(req, e) },
  { method: 'POST', re: /^\/api\/v1\/ops\/home-lines$/, handle: (req, e, a) => postHomeLine(req, e, a) },
  { method: 'GET', re: /^\/api\/v1\/ops\/home-lines\/([^/]+)$/, handle: (req, e, _a, p) => getHomeLine(req, e, p[0]) },
  { method: 'PATCH', re: /^\/api\/v1\/ops\/home-lines\/([^/]+)$/, handle: (req, e, a, p) => patchHomeLineRoute(req, e, p[0], a) },
  { method: 'DELETE', re: /^\/api\/v1\/ops\/home-lines\/([^/]+)$/, handle: (req, e, a, p) => deleteHomeLine(req, e, p[0], a) },
  { method: 'GET', re: /^\/api\/v1\/ops\/alert-rules$/, handle: (req, e) => getAlertRules(req, e) },
  { method: 'POST', re: /^\/api\/v1\/ops\/alert-rules$/, handle: (req, e, a) => postAlertRule(req, e, a) },
  { method: 'POST', re: /^\/api\/v1\/ops\/alert-rules\/([^/]+)\/test$/, handle: (req, e, a, p) => postAlertRuleTest(req, e, p[0], a) },
  { method: 'GET', re: /^\/api\/v1\/ops\/alert-rules\/([^/]+)$/, handle: (req, e, _a, p) => getAlertRule(req, e, p[0]) },
  { method: 'PATCH', re: /^\/api\/v1\/ops\/alert-rules\/([^/]+)$/, handle: (req, e, a, p) => patchAlertRule(req, e, p[0], a) },
  { method: 'DELETE', re: /^\/api\/v1\/ops\/alert-rules\/([^/]+)$/, handle: (req, e, a, p) => deleteAlertRule(req, e, p[0], a) },
  { method: 'GET', re: /^\/api\/v1\/ops\/alert-deliveries$/, handle: (req, e) => getAlertDeliveries(req, e) },
  { method: 'GET', re: /^\/api\/v1\/ops\/system\/health$/, handle: (req, e) => getSystemHealth(req, e) },
  { method: 'GET', re: /^\/api\/v1\/ops\/ledger$/, handle: (req, e) => getLedger(req, e) },
  { method: 'POST', re: /^\/api\/v1\/ops\/ledger$/, handle: (req, e, a) => postLedger(req, e, a) },
  { method: 'POST', re: /^\/api\/v1\/ops\/ledger\/([^/]+)\/reverse$/, handle: (req, e, a, p) => postLedgerReverse(req, e, p[0], a) },
  { method: 'PATCH', re: /^\/api\/v1\/ops\/ledger\/([^/]+)$/, handle: (req, e, a, p) => patchLedger(req, e, p[0], a) },
  { method: 'GET', re: /^\/api\/v1\/ops\/months\/([^/]+)\/export\.csv$/, handle: (req, e, _a, p) => getMonthExport(req, e, p[0]) },
  { method: 'POST', re: /^\/api\/v1\/ops\/months\/([^/]+)\/close$/, handle: (req, e, a, p) => postMonthClose(req, e, p[0], a) },
  { method: 'GET', re: /^\/api\/v1\/ops\/months\/([^/]+)$/, handle: (req, e, _a, p) => getMonth(req, e, p[0]) },
  { method: 'GET', re: /^\/api\/v1\/ops\/fx$/, handle: (req, e) => getFx(req, e) },
];

export async function dispatchOpsV1(
  req: Request,
  e: Env,
  p: string,
  m: string,
  actor: Actor,
): Promise<Response | null> {
  for (const route of ROUTES) {
    if (route.method !== m) continue;
    const match = p.match(route.re);
    if (!match) continue;
    return route.handle(req, e, actor, match.slice(1));
  }
  return null;
}
