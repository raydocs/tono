import type { CustomerSummaryDto } from '@contract';
import { StatTile } from '@/components/ops/StatTile';
import { copy } from '@/copy/copy';
import { nowSec } from '@/lib/clock';
import { listStats } from '@/lib/customer-board';
import { formatBytesMeasured, formatTally } from '@/lib/display';

const words = copy.customerBoard;

/**
 * Six numbers over the paying customers the shell already read: who is on
 * now, who came by this week, who failed today, what they used, who is about
 * to run dry and who is about to lapse. `null` rows leave every tile a dash.
 */
export function ListBand({ rows }: { rows: readonly CustomerSummaryDto[] | null }) {
  const ready = rows !== null;
  const stats = listStats(rows ?? [], nowSec());
  return (
    <div className="customers-stats">
      <StatTile
        label={words.stat.online}
        value={ready && stats.reporting > 0 ? formatTally(stats.online) : null}
        tone={ready && stats.online > 0 ? 'ok' : undefined}
        sub={ready ? (stats.reporting === 0 ? words.onlineNone : words.onlineSub(stats.reporting)) : null}
      />
      <StatTile
        label={words.stat.seenWeek}
        value={ready ? formatTally(stats.seenWeek) : null}
        sub={ready ? words.seenWeekSub(stats.active) : null}
      />
      <StatTile
        label={words.stat.failedDay}
        value={ready ? formatTally(stats.failedDay) : null}
        tone={ready && stats.failedDay > 0 ? 'sev' : undefined}
        sub={ready ? words.failedDaySub : null}
      />
      <StatTile
        label={words.stat.usage}
        value={stats.usage === null ? null : formatBytesMeasured(stats.usage)}
        sub={ready ? words.usageSub(stats.unmetered) : null}
      />
      <StatTile
        label={words.stat.nearQuota}
        value={ready ? formatTally(stats.nearQuota) : null}
        tone={ready && stats.nearQuota > 0 ? 'warn' : undefined}
        sub={ready ? words.nearQuotaSub : null}
      />
      <StatTile
        label={words.stat.expiring}
        value={ready ? formatTally(stats.expiringWeek) : null}
        tone={ready && (stats.expiringWeek > 0 || stats.expired > 0) ? 'warn' : undefined}
        sub={ready ? words.expiringSub(stats.expired) : null}
      />
    </div>
  );
}
