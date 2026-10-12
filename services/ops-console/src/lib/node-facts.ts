import type { NodeSummaryDto, QuotaCounts, QuotaCycleKind } from '@contract';
import { copy } from '@/copy/copy';
import { nodeApi, type NodeProfileInput } from './api-node';
import { gbToBytes, numberOrNull, textOrNull } from './node-detail';
import { fromDateInput } from './settings';

/**
 * Hand-kept facts that are missing across the fleet, and the one patch that
 * fills them in for many machines at once.
 *
 * A machine is "missing" the way the table and the node page already say it:
 * no allowance is a quota that is absent or not above zero, no expiry is
 * neither an expiry date nor a renewal date. Retired machines are left out,
 * since nobody types facts into a box that is no longer sold.
 */

export type FactsGaps = {
  /** Names of active machines with no allowance entered. */
  noQuota: string[];
  /** Names of active machines with neither an expiry date nor a renewal date. */
  noExpiry: string[];
};

export const isActiveNode = (row: NodeSummaryDto): boolean => row.lifecycle !== 'retired';

export function lacksQuota(row: NodeSummaryDto): boolean {
  // Same reading as the table cell: a quota the engine did not stamp is not shown.
  const cell = row.quota.asOfSec === null ? null : row.quota.value;
  const bytes = cell?.quota ?? null;
  return bytes === null || bytes <= 0;
}

export function lacksExpiry(row: NodeSummaryDto): boolean {
  return (row.expiresAt ?? row.renewsAt) === null;
}

export function nodeFactsGaps(rows: readonly NodeSummaryDto[]): FactsGaps {
  const active = rows.filter(isActiveNode);
  return {
    noQuota: active.filter(lacksQuota).map((row) => row.name),
    noExpiry: active.filter(lacksExpiry).map((row) => row.name),
  };
}

/** The two billing periods an invoice is usually written in, as days; empty leaves it alone. */
export const BILLING_CHOICES = ['', '30', '365'] as const;
export type BillingChoice = (typeof BILLING_CHOICES)[number];

/** Every box as the operator left it. Empty text and the empty choices mean "do not touch". */
export type BatchForm = {
  quotaGb: string;
  cycleKind: QuotaCycleKind | '';
  anchorDay: string;
  counts: QuotaCounts | '';
  billing: BillingChoice;
  expires: string;
  price: string;
  currency: string;
};

export const EMPTY_BATCH: BatchForm = {
  quotaGb: '',
  cycleKind: '',
  anchorDay: '1',
  counts: '',
  billing: '',
  expires: '',
  price: '',
  currency: '',
};

export type BatchProblem =
  | 'empty' | 'quota' | 'quotaRules' | 'anchor' | 'expires' | 'price' | 'priceCycle' | 'currency';

const filled = (text: string) => text.trim() !== '';

/**
 * Why this form cannot be sent yet, or null. The rules are the Worker's own
 * (profile PATCH), checked here so a refusal is not discovered fourteen times.
 */
export function batchProblem(form: BatchForm): BatchProblem | null {
  const any = filled(form.quotaGb) || filled(form.expires) || filled(form.price)
    || filled(form.currency) || form.billing !== '';
  if (!any) return 'empty';
  if (filled(form.quotaGb)) {
    const gb = numberOrNull(form.quotaGb);
    if (gb === null || gb <= 0 || !Number.isSafeInteger(gbToBytes(form.quotaGb))) return 'quota';
    if (form.cycleKind === '' || form.counts === '') return 'quotaRules';
    const day = numberOrNull(form.anchorDay);
    if (day === null || !Number.isInteger(day) || day < 1 || day > 31) return 'anchor';
  }
  if (filled(form.expires) && fromDateInput(form.expires) === null) return 'expires';
  if (filled(form.price)) {
    const price = numberOrNull(form.price);
    if (price === null || price < 0) return 'price';
    if (form.billing === '') return 'priceCycle';
  }
  if (filled(form.currency) && !/^[A-Za-z]{3}$/.test(form.currency.trim())) return 'currency';
  return null;
}

/**
 * The patch every picked machine gets: only the keys the operator filled.
 * A missing key means "unchanged" to the Worker, which is the whole point of
 * a batch; nothing here ever sends null. The quota travels whole, because the
 * Worker takes its four parts together, in bytes like the per-node form.
 */
export function batchPatch(form: BatchForm): NodeProfileInput {
  const patch: NodeProfileInput = {};
  if (filled(form.quotaGb) && form.cycleKind !== '' && form.counts !== '') {
    patch.quota = {
      quotaBytes: gbToBytes(form.quotaGb) ?? 0,
      cycleKind: form.cycleKind,
      cycleAnchorDay: numberOrNull(form.anchorDay) ?? 1,
      counts: form.counts,
    };
  }
  if (form.billing !== '') patch.billingCycle = Number(form.billing);
  if (filled(form.expires)) patch.expiresAt = fromDateInput(form.expires);
  if (filled(form.price)) patch.price = numberOrNull(form.price);
  const currency = textOrNull(form.currency);
  if (currency !== null) patch.currency = currency.toUpperCase();
  return patch;
}

export type BatchResult = {
  done: string[];
  failed: Array<{ name: string; reason: string }>;
};

/**
 * One machine at a time, so a refusal names the machine it belongs to.
 * A failure never stops the rest.
 */
export async function registerBatch(
  names: readonly string[],
  patch: NodeProfileInput,
  onStep?: (finished: number) => void,
): Promise<BatchResult> {
  const result: BatchResult = { done: [], failed: [] };
  for (const name of names) {
    try {
      await nodeApi.saveProfile(name, patch);
      result.done.push(name);
    } catch (failure) {
      result.failed.push({ name, reason: failure instanceof Error ? failure.message : copy.actionFailed });
    }
    onStep?.(result.done.length + result.failed.length);
  }
  return result;
}
