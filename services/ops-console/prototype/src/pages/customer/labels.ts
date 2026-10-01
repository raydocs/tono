import type { Tone } from '@proto/ds';
import type { TimelineEvent } from '@proto/mock/customers';

export const EVENT: Record<TimelineEvent['kind'], { label: string; tone: Tone }> = {
  connectOk: { label: '连上', tone: 'ok' },
  connectFail: { label: '失败', tone: 'sev' },
  nodeSwitch: { label: '换节点', tone: 'info' },
  catalogSync: { label: '目录', tone: 'idle' },
  appUpdate: { label: '更新', tone: 'idle' },
  quota: { label: '额度', tone: 'warn' },
  support: { label: '客服', tone: 'info' },
};
