export function timestamp(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return new Date(value * 1_000).toLocaleString();
}

export function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 'B';
  for (const next of units) {
    if (size < 1024) break;
    size /= 1024;
    unit = next;
  }
  return `${size >= 100 ? Math.round(size) : size.toFixed(1)} ${unit}`;
}

export function timeAgo(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  const seconds = Math.max(0, Math.floor(Date.now() / 1_000) - value);
  if (seconds < 90) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return '—';
  const days = Math.floor(seconds / 86_400);
  if (days > 0) return `${days} 天`;
  const hours = Math.floor(seconds / 3_600);
  if (hours > 0) return `${hours} 小时`;
  return `${Math.max(1, Math.floor(seconds / 60))} 分钟`;
}
