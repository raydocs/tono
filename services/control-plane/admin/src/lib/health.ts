/**
 * What a page has to admit about the data it is drawing.
 *
 * `StateBoundary` only ever guarded each page's primary resource. Everything
 * else — server profiles, activity, audit, metrics — failed into an empty array
 * and drew as though the answer were genuinely "none". That is how the server
 * list printed an occupancy of 0 for every node whenever the activity call
 * failed: zero is a claim, absence is not.
 *
 * The frozen case is the worse one, because nothing on screen moves. A
 * background refresh that starts failing — an expired Access session does this
 * to every call on the page at once — leaves the last good snapshot in place
 * for as long as the tab is open. `useResource` keeps that snapshot on purpose
 * and records why the refresh failed; this turns the record into a sentence, so
 * an hour-old page is never read as a current one.
 */
export type HealthSource = {
  label: string;
  state: 'loading' | 'error' | 'ready';
  stale: string | null;
  refreshedAt: number;
};

function sinceLabel(ms: number, nowMs: number) {
  if (!ms) return '更早';
  const seconds = Math.max(0, Math.round((nowMs - ms) / 1_000));
  if (seconds < 90) return '刚刚';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.round(minutes / 60)} 小时前`;
}

export function dataHealthLines(sources: HealthSource[], nowMs: number): string[] {
  const failed = sources.filter((source) => source.state === 'error');
  // A source that has failed outright is reported as missing, not as stale;
  // saying both about the same thing reads as two separate problems.
  const stale = sources.filter((source) => source.state !== 'error' && source.stale);
  const lines: string[] = [];
  if (failed.length) {
    lines.push(`${failed.map((source) => source.label).join('、')}没能加载，这一页里由它们得出的数字都不作数。`);
  }
  if (stale.length) {
    const oldest = Math.min(...stale.map((source) => source.refreshedAt || 0));
    lines.push(`${stale.map((source) => source.label).join('、')}的自动刷新失败（${stale[0].stale}），显示的是${sinceLabel(oldest, nowMs)}的快照。`);
  }
  return lines;
}
