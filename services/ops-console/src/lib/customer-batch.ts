import type { CustomerSummaryDto } from '@contract';
import { batchCopy as words } from '@/copy/batch';
import { copy } from '@/copy/copy';
import { opsApi } from './api';
import { customerApi, WriteRefusal } from './api-customer-actions';
import { nowSec } from './clock';
import { extendedExpiry, refreshable } from './customers';

export type BatchKind = 'refresh' | 'renew';
export type BatchStatus = keyof typeof words.states;
export type BatchItem = {
  id: string;
  userId: string;
  email: string;
  deviceId?: string;
  deviceName?: string;
  operation: BatchKind | 'discover';
  originalExpiry?: number | null;
  targetExpiry?: number;
  receiptId?: string;
  status: BatchStatus;
  retryable: boolean;
  note?: string;
};
type BatchState = { kind: BatchKind | null; busy: boolean; items: readonly BatchItem[] };

// Tab-memory only: navigating to a customer must not lose in-flight results.
// Nothing is stored on disk and reload never resumes a write automatically.
let state: BatchState = { kind: null, busy: false, items: [] };
const listeners = new Set<() => void>();
export const batchSnapshot = () => state;
export function subscribeBatch(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(next: BatchState) {
  state = next;
  listeners.forEach((listener) => listener());
}
function update(id: string, patch: Partial<BatchItem>) {
  publish({ ...state, items: state.items.map((item) => item.id === id ? { ...item, ...patch } : item) });
}

/** A single pool, not a customer pool multiplied by a device pool. */
async function limited<T>(items: readonly T[], work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

function writeFailure(item: BatchItem, failure: unknown) {
  // Timeout, malformed success, 5xx, and session redirects are ambiguous:
  // a server may have committed before its response disappeared.
  const refused = failure instanceof WriteRefusal
    && [400, 404, 405, 409, 422, 429].includes(failure.status);
  update(item.id, {
    status: refused ? 'failed' : 'unknown', retryable: refused,
    note: refused ? words.refused(failure.status) : words.uncertain,
  });
}

async function discover(item: BatchItem) {
  update(item.id, { status: 'checking', retryable: false, note: undefined });
  try {
    const detail = await opsApi.customer(item.userId);
    const devices = refreshable(detail.devices);
    if (devices.length === 0) {
      update(item.id, { status: 'skipped', note: copy.batchRefreshNoDevices });
      return;
    }
    const children: BatchItem[] = devices.map((device) => ({
      id: `${item.userId}/${device.id}`, userId: item.userId, email: item.email,
      deviceId: device.id, deviceName: device.name, operation: 'refresh',
      status: 'waiting', retryable: false,
    }));
    publish({ ...state, items: state.items.flatMap((row) => row.id === item.id ? children : [row]) });
  } catch {
    update(item.id, { status: 'failed', retryable: true, note: words.readFailed });
  }
}

async function verifyRenewal(item: BatchItem) {
  try {
    const current = await opsApi.customer(item.userId);
    const matches = current.billing.expiresAt === item.targetExpiry;
    update(item.id, {
      status: matches ? 'done' : 'unknown', retryable: false,
      note: matches ? words.renewalVerified : words.renewalUnverified,
    });
  } catch {
    update(item.id, { status: 'unknown', retryable: false, note: words.renewalUnverified });
  }
}

async function submit(item: BatchItem) {
  update(item.id, { status: 'checking', retryable: false, note: undefined });
  if (item.operation === 'renew') {
    // Freeze the original + target dates; retry must not add another period or
    // overwrite a date changed since selection. This is not server-side CAS.
    try {
      const current = await opsApi.customer(item.userId);
      if (current.billing.expiresAt !== item.originalExpiry) {
        update(item.id, { status: 'skipped', note: words.changed });
        return;
      }
    } catch {
      update(item.id, { status: 'failed', retryable: true, note: words.readFailed });
      return;
    }
  }
  update(item.id, { status: 'submitting' });
  try {
    if (item.operation === 'renew') {
      await customerApi.patchUser(item.userId, { expiresAt: item.targetExpiry });
      update(item.id, { status: 'checking' });
      await verifyRenewal(item);
    } else {
      const receipt = await customerApi.queueDeviceAction(item.deviceId!, 'refresh_catalog');
      update(item.id, { receiptId: receipt.id, status: 'submitted' });
    }
  } catch (failure) {
    writeFailure(item, failure);
  }
}

async function execute(items: readonly BatchItem[]) {
  publish({ ...state, busy: true });
  try {
    await limited(items.filter((item) => item.operation === 'discover'), discover);
    // Newly discovered devices plus the exact retry set. Never resend a
    // sibling that already has a receipt (even if that receipt is now failed).
    const retryIds = new Set(items.filter((item) => item.operation !== 'discover').map((item) => item.id));
    await limited(state.items.filter((item) => item.status === 'waiting' || retryIds.has(item.id)), submit);
  } finally {
    publish({ ...state, busy: false });
  }
}

export async function startBatch(kind: BatchKind, rows: readonly CustomerSummaryDto[]) {
  if (state.busy || state.kind !== null || rows.length === 0) return;
  const at = nowSec();
  const items: BatchItem[] = rows.map((row) => ({
    id: row.userId, userId: row.userId, email: row.email,
    operation: kind === 'refresh' ? 'discover' : 'renew',
    originalExpiry: row.expiresAt,
    targetExpiry: kind === 'renew' ? extendedExpiry(row.expiresAt, at) : undefined,
    status: 'waiting', retryable: false,
  }));
  publish({ kind, busy: true, items });
  await execute(items);
}

export async function retryBatch() {
  if (state.busy) return;
  await execute(state.items.filter((item) => item.status === 'failed' && item.retryable));
}

export async function inspectBatch() {
  if (state.busy) return;
  const items = state.items.filter((item) => ['submitted', 'delivered', 'unknown'].includes(item.status)
    && (item.operation === 'renew' || item.receiptId));
  if (items.length === 0) return;
  publish({ ...state, busy: true });
  try {
    await limited(items, async (item) => {
      if (item.operation === 'renew') return verifyRenewal(item);
      if (!item.receiptId) return; // No correlation id: never guess from "latest".
      try {
        const receipts = await customerApi.deviceActions(item.deviceId!);
        const receipt = receipts.find((row) => row.id === item.receiptId);
        let status: BatchStatus = 'unknown';
        let note: string | undefined;
        if (!receipt) note = words.receiptMissing;
        else if (receipt.status === 'pending') status = 'submitted';
        else if (receipt.status === 'delivered') status = 'delivered';
        else if (['done', 'completed'].includes(receipt.status)) { status = 'done'; note = words.deviceDone; }
        else if (['expired', 'failed'].includes(receipt.status)) { status = 'failed'; note = words.deviceFailed; }
        else note = words.receiptMissing;
        update(item.id, { status, note, retryable: false });
      } catch {
        update(item.id, { note: words.receiptFailed });
      }
    });
  } finally {
    publish({ ...state, busy: false });
  }
}

export function dismissBatch() {
  if (!state.busy) publish({ kind: null, busy: false, items: [] });
}
