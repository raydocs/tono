import type { Tone } from '@proto/ds';
import type { CustomerState } from '@proto/mock/customers';

export const STATE: Record<CustomerState, { label: string; tone: Tone }> = {
  online: { label: '在线', tone: 'ok' },
  failing: { label: '连不上', tone: 'sev' },
  offline: { label: '离线', tone: 'idle' },
  never: { label: '没连上过', tone: 'info' },
  expired: { label: '已到期', tone: 'warn' },
  disabled: { label: '已停用', tone: 'idle' },
};
