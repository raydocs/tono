import type { CustomerDeviceDto, CustomerNowDto } from '@contract';
import { copy } from '@/copy/copy';

export type SloCarrier = 'mobile' | 'telecom' | 'unicom' | 'other';

/**
 * The carrier bucket the daily SLO rollup files an attempt under, read off
 * the customer's carrier text with the same rules as `slo-rollup.ts`
 * (`edge_as_org` matched for mobile / telecom / unicom, everything else
 * `other`). No carrier at all means no carrier filter.
 */
export function sloCarrierOf(carrier: string | null): SloCarrier | null {
  if (carrier === null || carrier.trim() === '') return null;
  const lower = carrier.toLowerCase();
  const han = copy.customerSlo.carrierMatch;
  if (lower.includes('mobile') || lower.includes('cmcc') || carrier.includes(han.mobile)) return 'mobile';
  if (lower.includes('telecom') || lower.includes('chinanet') || carrier.includes(han.telecom)) return 'telecom';
  if (lower.includes('unicom') || carrier.includes(han.unicom)) return 'unicom';
  return 'other';
}

/**
 * The node this customer's experience is read against: the one they are on
 * now, else the selection of the device seen most recently. Null when no
 * device has ever reported one.
 */
export function sloNodeOf(
  now: CustomerNowDto | null,
  devices: readonly CustomerDeviceDto[],
): string | null {
  if (now?.node) return now.node;
  let newest: CustomerDeviceDto | null = null;
  for (const device of devices) {
    if (device.selectedServer === null) continue;
    if (newest === null || (device.lastSeenAt ?? 0) > (newest.lastSeenAt ?? 0)) newest = device;
  }
  return newest?.selectedServer ?? null;
}
