import type { ActivityHourDto } from '@contract';
import { copy } from '@/copy/copy';
import { formatBytesMeasured, formatClock } from '@/lib/display';
import { Value } from './Value';

const HOURS_IN_DAY = 24;
const MINUTES_IN_HOUR = 60;
/** Only every sixth hour is labelled; 24 numbers under a 7-row grid is noise. */
const LABEL_EVERY = 6;

type Day = { key: number; label: string; hours: (ActivityHourDto | null)[] };

/**
 * Bucket the hours into calendar days without assuming the server sent a
 * complete grid: a missing hour stays `null` and renders as an empty cell,
 * which is the honest picture of "we have no measurement for 03:00" and not
 * the same thing as "they were offline at 03:00".
 */
function toDays(rows: readonly ActivityHourDto[]): Day[] {
  const byDay = new Map<number, Day>();
  for (const row of rows) {
    const date = new Date(row.hourAt * 1_000);
    const key = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    let day = byDay.get(key);
    if (!day) {
      day = {
        key,
        label: copy.weekday[date.getDay()],
        hours: Array.from({ length: HOURS_IN_DAY }, () => null),
      };
      byDay.set(key, day);
    }
    day.hours[date.getHours()] = row;
  }
  return [...byDay.values()].sort((a, b) => a.key - b.key);
}

/**
 * 使用时段: seven days of hours, greyscale for 在线 and the one accent for
 * 已连接. Two channels in one cell rather than two strips, because the
 * question the block answers — "were they online but not connected?" — is a
 * comparison, and a comparison across two grids is not one.
 */
export function HeatStrip({ rows, source }: { rows: readonly ActivityHourDto[]; source: string }) {
  if (rows.length === 0) return <Value value={null} source={source} />;
  const days = toDays(rows);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-[2px]">
        {days.map((day) => (
          <div key={day.key} className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-micro text-[var(--muted-foreground)]">{day.label}</span>
            <div className="flex min-w-0 flex-1 gap-[2px]">
              {day.hours.map((hour, index) => (
                <Cell key={index} hour={hour} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-8 shrink-0" />
        <div className="flex min-w-0 flex-1 gap-[2px]">
          {Array.from({ length: HOURS_IN_DAY }, (_, hour) => (
            <span
              key={hour}
              className="min-w-0 flex-1 text-center font-mono text-[9px] leading-none text-[var(--muted-foreground)]"
            >
              {hour % LABEL_EVERY === 0 ? hour : ''}
            </span>
          ))}
        </div>
      </div>
      <p className="text-micro text-[var(--muted-foreground)]">{copy.activityLegend}</p>
    </div>
  );
}

function Cell({ hour }: { hour: ActivityHourDto | null }) {
  if (hour === null) return <span className="heat-cell heat-gap min-w-0 flex-1" />;
  const connected = hour.connectedMinutes > 0;
  const share = Math.min(1, (connected ? hour.connectedMinutes : hour.onlineMinutes) / MINUTES_IN_HOUR);
  const bytes = formatBytesMeasured(hour.bytesUp + hour.bytesDown);
  return (
    <span
      data-connected={connected ? 'true' : 'false'}
      title={`${copy.activityHour(formatClock(hour.hourAt), hour.connectedMinutes)} · ${bytes}`}
      className="heat-cell min-w-0 flex-1"
      style={{ '--heat': share } as React.CSSProperties}
    />
  );
}
