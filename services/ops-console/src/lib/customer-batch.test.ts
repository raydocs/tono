import { afterEach, expect, it, vi } from 'vitest';
import type { CustomerDetailDto, CustomerDeviceDto, CustomerSummaryDto } from '@contract';
import { opsApi } from './api';
import { customerApi, WriteRefusal } from './api-customer-actions';
import { batchSnapshot, dismissBatch, inspectBatch, retryBatch, startBatch } from './customer-batch';
import type { DeviceAction } from './customers-legacy';

const customer = (userId: string, expiresAt = 2_000_000_000) => ({
  userId, email: `${userId}@example.com`, expiresAt,
}) as CustomerSummaryDto;
const device = (id: string) => ({ id, name: id, platform: 'macos', status: 'active' }) as CustomerDeviceDto;
const detail = (devices: CustomerDeviceDto[], expiresAt = 2_000_000_000) => ({
  devices, billing: { expiresAt },
}) as CustomerDetailDto;
const receipt = (id: string, status = 'pending') => ({ id, deviceId: id, status }) as DeviceAction;

afterEach(() => { dismissBatch(); vi.restoreAllMocks(); });

it('retries only refused devices and checks exact receipts without resending uncertain writes', async () => {
  vi.spyOn(opsApi, 'customer').mockResolvedValue(detail([device('ok'), device('refused'), device('uncertain')]));
  let refused = true;
  const send = vi.spyOn(customerApi, 'queueDeviceAction').mockImplementation(async (id) => {
    if (id === 'refused' && refused) throw new WriteRefusal(429, 'LIMIT', 'limited');
    if (id === 'uncertain') throw new WriteRefusal(500, 'UPSTREAM', 'lost response');
    return receipt(id);
  });
  await startBatch('refresh', [customer('u')]);
  expect(batchSnapshot().items.map((item) => item.status)).toEqual(['submitted', 'failed', 'unknown']);
  refused = false;
  await retryBatch();
  expect(send.mock.calls.map(([id]) => id)).toEqual(['ok', 'refused', 'uncertain', 'refused']);
  const reads = vi.spyOn(customerApi, 'deviceActions').mockImplementation(async (id) => [receipt('unrelated', 'completed'), receipt(id, 'delivered')]);
  await inspectBatch();
  expect(batchSnapshot().items.map((item) => item.status)).toEqual(['delivered', 'delivered', 'unknown']);
  expect(reads.mock.calls.map(([id]) => id)).toEqual(['ok', 'refused']);
  expect(send).toHaveBeenCalledTimes(4);
});

it('keeps the original renewal target across retries and verifies the date after writing', async () => {
  let expiry = 2_000_000_000;
  vi.spyOn(opsApi, 'customer').mockImplementation(async () => detail([], expiry));
  let first = true;
  const patch = vi.spyOn(customerApi, 'patchUser').mockImplementation(async (_id, input) => {
    if (first) { first = false; throw new WriteRefusal(429, 'LIMIT', 'limited'); }
    expiry = input.expiresAt!;
    return null;
  });
  await startBatch('renew', [customer('u', expiry)]);
  const target = batchSnapshot().items[0].targetExpiry;
  await retryBatch();
  expect(patch.mock.calls.map(([, input]) => input.expiresAt)).toEqual([target, target]);
  expect(batchSnapshot().items[0].status).toBe('done');
  await retryBatch();
  expect(patch).toHaveBeenCalledTimes(2);
});

it('does not overwrite an expiry that changed since selection', async () => {
  vi.spyOn(opsApi, 'customer').mockResolvedValue(detail([], 2_000_001_000));
  const patch = vi.spyOn(customerApi, 'patchUser');
  await startBatch('renew', [customer('u')]);
  expect(batchSnapshot().items[0]).toMatchObject({ status: 'skipped', retryable: false });
  expect(patch).not.toHaveBeenCalled();
});

it('bounds the combined customer and device fanout to three in-flight requests', async () => {
  let active = 0;
  let peak = 0;
  const hold = async <T,>(value: T) => {
    active += 1;
    peak = Math.max(active, peak);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return value;
  };
  vi.spyOn(opsApi, 'customer').mockImplementation((id) => hold(detail([device(`${id}-a`), device(`${id}-b`)])));
  const send = vi.spyOn(customerApi, 'queueDeviceAction').mockImplementation((id) => hold(receipt(id)));
  await startBatch('refresh', Array.from({ length: 5 }, (_, n) => customer(String(n))));
  expect(send).toHaveBeenCalledTimes(10);
  expect(peak).toBe(3);
  expect(active).toBe(0);
});
