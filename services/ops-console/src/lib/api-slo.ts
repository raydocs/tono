import type { SloResponseDto, SloRowDto, SloSummaryDto } from '@contract';
import { getJson } from './api';

export type { SloResponseDto, SloRowDto, SloSummaryDto };

export interface SloQuery {
  range?: '7d' | '30d';
  platform?: string;
  carrier?: string;
  node?: string;
}

export const sloApi = {
  get: (query?: SloQuery, signal?: AbortSignal): Promise<SloResponseDto> => {
    const q: Record<string, string> = {};
    if (query?.range) q.range = query.range;
    if (query?.platform) q.platform = query.platform;
    if (query?.carrier) q.carrier = query.carrier;
    if (query?.node) q.node = query.node;
    return getJson<SloResponseDto>('slo', signal, q);
  },
};
