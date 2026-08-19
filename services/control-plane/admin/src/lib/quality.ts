import type { LiveQualityNodeDto } from '../api';

export const blockLabels: Record<string, string> = {
  OK: '大陆正常',
  LIKELY_BLOCKED: '疑似被墙',
  DEGRADED: '部分不通',
  EDGE_OK: '边缘可达',
  EDGE_FAIL: '边缘不通',
  DOWN: '不通',
  UNPROBED: '大陆未测',
  PROBE_PARTIAL: '大陆未测',
  CHECK_FAILED: '探测失败',
};

export function blockStatus(node: LiveQualityNodeDto) {
  return node.block?.status || (node.ok ? 'OK' : 'DOWN');
}

export function blockLabel(node: LiveQualityNodeDto) {
  const status = blockStatus(node);
  return node.block?.label || blockLabels[status] || status;
}

export function isLikelyBlocked(node: LiveQualityNodeDto) {
  return blockStatus(node) === 'LIKELY_BLOCKED';
}

export function probeRatio(probe: { success?: number; total?: number } | null | undefined) {
  if (!probe || probe.total == null) return '—';
  return `${probe.success ?? 0}/${probe.total}`;
}
