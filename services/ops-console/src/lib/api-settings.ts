import type {
  AlertDeliveryDto,
  AlertRuleDto,
  AuditListDto,
  DirectCandidateDto,
  HomeLineDto,
  HomeLineUsageDayDto,
  ListDto,
  ProviderAccountDto,
} from '@contract';
import { deleteJson, getJson, patchJson, postJson } from './api';

/**
 * The 设置 page's half of the wire.
 *
 * It sits beside `opsApi` rather than inside it because these are the only
 * endpoints the console writes to with anything but a fixed action verb: a
 * create here sends a whole record, and the field lists below are the contract
 * for that record. `opsApi` stays a list of reads plus four incident verbs.
 */

/** What a create or edit sends. Keys the Worker rejects are absent on purpose. */
export type AlertRuleInput = Pick<
  AlertRuleDto,
  'name' | 'enabled' | 'matchKind' | 'matchSubjectType' | 'matchSubjectId'
  | 'minSeverity' | 'minImpact' | 'fireOn' | 'delaySeconds' | 'cooldownSeconds'
  | 'channel' | 'target' | 'template' | 'secretRef'
>;

/**
 * `loginEmail`, not `loginEmailMasked`: the console sends the address it was
 * given and the Worker masks it on the way into the database, so the console
 * never holds an unmasked copy it could leak back out on the next read.
 */
export type ProviderAccountInput = Pick<
  ProviderAccountDto,
  'provider' | 'label' | 'cloudKind' | 'billingUrl' | 'balanceHint' | 'renewNotes' | 'secretRef'
> & { loginEmail: string | null };

export type HomeLineInput = Pick<
  HomeLineDto,
  'proxyName' | 'displayName' | 'isp' | 'region' | 'providerAccountId' | 'price' | 'currency'
  | 'billingKind' | 'bundleBytes' | 'cycleStart' | 'cycleEnd' | 'expiresAt' | 'meterSource' | 'notes'
>;

/** `audit` pages on `(at, id)`, not on a cursor string; both halves travel. */
export type AuditQuery = {
  before?: number | null;
  beforeId?: string | null;
  targetId?: string | null;
  actorEmail?: string | null;
  limit?: number;
};

function auditParams(query: AuditQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.limit !== undefined) params.limit = String(query.limit);
  if (query.before !== undefined && query.before !== null) {
    params.before = String(query.before);
    if (query.beforeId) params.beforeId = query.beforeId;
  }
  if (query.targetId) params.targetId = query.targetId;
  if (query.actorEmail) params.actorEmail = query.actorEmail;
  return params;
}

const path = (...parts: string[]) => parts.map(encodeURIComponent).join('/');

/** What `traffic-policy/draft-from-candidates` hands back: a draft and a caveat. */
export type CandidateDraftDto = { draft: unknown; note: string };

export const settingsApi = {
  alertRules: (signal?: AbortSignal) => getJson<ListDto<AlertRuleDto>>('alert-rules', signal),
  createAlertRule: (input: AlertRuleInput) => postJson<AlertRuleDto>('alert-rules', input),
  updateAlertRule: (id: string, input: Partial<AlertRuleInput>) =>
    patchJson<AlertRuleDto>(path('alert-rules', id), input),
  deleteAlertRule: (id: string) => deleteJson<null>(path('alert-rules', id)),
  testAlertRule: (id: string) => postJson<AlertRuleDto>(`${path('alert-rules', id)}/test`, {}),
  alertDeliveries: (signal?: AbortSignal) =>
    getJson<ListDto<AlertDeliveryDto>>('alert-deliveries', signal),

  providerAccounts: (signal?: AbortSignal) =>
    getJson<ListDto<ProviderAccountDto>>('provider-accounts', signal),
  createProviderAccount: (input: ProviderAccountInput) =>
    postJson<ProviderAccountDto>('provider-accounts', input),
  updateProviderAccount: (id: string, input: Partial<ProviderAccountInput>) =>
    patchJson<ProviderAccountDto>(path('provider-accounts', id), input),
  deleteProviderAccount: (id: string) =>
    deleteJson<ProviderAccountDto>(path('provider-accounts', id)),

  homeLines: (signal?: AbortSignal) => getJson<ListDto<HomeLineDto>>('home-lines', signal),
  homeLineUsage: (id: string, signal?: AbortSignal) =>
    getJson<ListDto<HomeLineUsageDayDto>>(`${path('home-lines', id)}/usage`, signal, { range: '30d' }),
  createHomeLine: (input: HomeLineInput) => postJson<HomeLineDto>('home-lines', input),
  updateHomeLine: (id: string, input: Partial<Omit<HomeLineInput, 'proxyName'>>) =>
    patchJson<HomeLineDto>(path('home-lines', id), input),
  deleteHomeLine: (id: string) => deleteJson<HomeLineDto>(path('home-lines', id)),

  directCandidates: (signal?: AbortSignal) =>
    getJson<ListDto<DirectCandidateDto>>('direct-candidates', signal),
  acceptCandidate: (etld1: string) =>
    postJson<DirectCandidateDto>(`${path('direct-candidates', etld1)}/accept`, {}),
  rejectCandidate: (etld1: string) =>
    postJson<DirectCandidateDto>(`${path('direct-candidates', etld1)}/reject`, {}),
  candidateDraft: () =>
    postJson<CandidateDraftDto>('traffic-policy/draft-from-candidates', {}),

  audit: (query: AuditQuery, signal?: AbortSignal) =>
    getJson<AuditListDto>('audit', signal, auditParams(query)),
};
