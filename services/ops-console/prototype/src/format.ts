/** Every number the prototype prints goes through here. */

export const NOW = Date.UTC(2026, 8, 30, 10, 40);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function pct(value: number | null, digits = 1): string {
  if (value == null) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function ms(value: number | null): string {
  if (value == null) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

export function int(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString('zh-CN');
}

export function bytes(value: number | null): string {
  if (value == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = value;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function rate(bitsPerSecond: number): string {
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  let v = bitsPerSecond;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i += 1; }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function cny(minor: number): string {
  return `${minor < 0 ? '−' : ''}¥${(Math.abs(minor) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function usd(minor: number): string {
  return `${minor < 0 ? '−' : ''}$${(Math.abs(minor) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function ago(at: number): string {
  const d = NOW - at;
  if (d < 60_000) return '刚刚';
  if (d < HOUR) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < DAY) return `${Math.floor(d / HOUR)} 小时前`;
  return `${Math.floor(d / DAY)} 天前`;
}

export function until(at: number): string {
  const d = at - NOW;
  if (d < 0) return `已过 ${Math.ceil(-d / DAY)} 天`;
  if (d < DAY) return `${Math.max(1, Math.floor(d / HOUR))} 小时后`;
  return `${Math.floor(d / DAY)} 天后`;
}

const fmtDate = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' });
const fmtTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });

export function date(at: number): string { return fmtDate.format(at); }
export function time(at: number): string { return fmtTime.format(at); }
export function dateTime(at: number): string { return `${fmtDate.format(at)} ${fmtTime.format(at)}`; }

export { HOUR, DAY };
