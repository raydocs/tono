export type NodeHealth = 'ok' | 'blocked' | 'down' | 'unknown';

export const NODE_HEALTH_LABELS: Record<NodeHealth, string> = {
  ok: '大陆正常',
  blocked: '疑似被墙',
  down: '整机失联',
  unknown: '未测',
};

export function isNodeHealth(value: string | null | undefined): value is NodeHealth {
  return value === 'ok' || value === 'blocked' || value === 'down' || value === 'unknown';
}

export function nodeHealthLabel(value: string | null | undefined): string {
  if (!isNodeHealth(value)) return NODE_HEALTH_LABELS.unknown;
  return NODE_HEALTH_LABELS[value];
}

export function nodeHealthTone(value: string | null | undefined): 'ok' | 'warn' | 'bad' | 'unknown' {
  if (value === 'ok') return 'ok';
  if (value === 'blocked') return 'warn';
  if (value === 'down') return 'bad';
  return 'unknown';
}

export function formatExitDelay(ms: number | null | undefined): string {
  if (ms == null) return '出口未测';
  if (ms >= 400) return `出口较慢 ${ms}ms`;
  return `出口 ${ms}ms`;
}

export function formatTcpDelay(ms: number | null | undefined): string {
  if (ms == null) return 'TCP 未测';
  if (ms >= 400) return `TCP 较慢 ${ms}ms`;
  return `TCP ${ms}ms`;
}
