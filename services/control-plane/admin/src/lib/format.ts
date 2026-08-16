export function timestamp(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return new Date(value * 1_000).toLocaleString();
}

// Scaled on magnitude, with the sign put back afterwards. A negative byte
// count is not a nonsense input here: the server list's 余量 column is
// `quota - used`, so the moment a node goes over its plan the number goes
// negative — and that is exactly the row somebody needs to read. Comparing the
// signed value against 1024 sent every one of them down the "already small
// enough" branch, which printed -3221225472 B where -3.0 GB belonged.
export function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  const sign = value < 0 ? '-' : '';
  let size = Math.abs(value);
  if (size < 1024) return `${sign}${size} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let unit = 'B';
  for (const next of units) {
    if (size < 1024) break;
    size /= 1024;
    unit = next;
  }
  return `${sign}${size >= 100 ? Math.round(size) : size.toFixed(1)} ${unit}`;
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
