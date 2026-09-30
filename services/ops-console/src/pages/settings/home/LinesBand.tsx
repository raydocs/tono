import type { HomeLineDto } from '@contract';
import { StatTile } from '@/components/ops/StatTile';
import { copy } from '@/copy/copy';
import { nowSec } from '@/lib/clock';
import { formatBytesMeasured, formatRate, formatTally } from '@/lib/display';
import { formatDeadline, formatMoney } from '@/lib/node-detail';
import { usePrivacy } from '@/lib/privacy';
import { probeShare, renewsSoon, rentByCurrency, usedBytes } from '@/lib/residential';

const words = copy.residential.lines;
const WEEK_SEC = 7 * 86_400;

/**
 * Six numbers over the billed lines: how many are in use, which are about to
 * lapse, what a period of rent comes to, how much went through them, how
 * often the probes got through and how many customers they carry. `null`
 * rows (a read that has not answered) leave every tile a dash.
 */
export function LinesBand({ rows }: { rows: readonly HomeLineDto[] | null }) {
  const privacy = usePrivacy();
  const now = nowSec();
  const ready = rows !== null;
  const all = rows ?? [];
  const active = all.filter((row) => row.status === 'active');
  const retired = all.length - active.length;

  const soon = active.filter((row) => renewsSoon(row, now))
    .sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0));
  const first = soon[0]?.expiresAt ?? null;

  const rents = rentByCurrency(all);
  const rentText = rents.map((row) => formatMoney(row.amount, row.currency)).filter((text): text is string => text !== null);

  const used = active.map(usedBytes);
  const metered = used.filter((value): value is number => value !== null);

  const share = probeShare(active.map((row) => ({ alive: row.probe.value?.alive ?? null, total: row.probe.value?.total ?? null })));
  const dead = active.filter((row) => row.probe.value !== null && row.probe.value.total > 0 && row.probe.value.alive === 0).length;
  const customers = active.reduce((sum, row) => sum + row.boundUsers.value, 0);

  return (
    <div className="home-stats">
      <StatTile
        label={words.stat.lines}
        value={ready ? formatTally(active.length) : null}
        sub={ready ? words.linesSub(retired) : null}
      />
      <StatTile
        label={words.stat.soon}
        value={ready ? formatTally(soon.length) : null}
        tone={ready && soon.length > 0 ? (first !== null && first - now < WEEK_SEC ? 'warn' : 'rem') : undefined}
        sub={ready ? (first === null ? words.soonNone : words.soonSub(formatDeadline(first) ?? copy.missing)) : null}
      />
      <StatTile
        label={words.stat.rent}
        value={rentText.length === 0 ? null : privacy.money(rentText[0])}
        sub={ready
          ? rentText.length === 0 ? words.rentNone
            : rentText.length === 1 ? words.rentOnly : words.rentSub(privacy.money(rentText.slice(1).join(' · ')))
          : null}
      />
      <StatTile
        label={words.stat.usage}
        value={metered.length === 0 ? null : formatBytesMeasured(metered.reduce((sum, value) => sum + value, 0))}
        sub={ready ? words.usageSub(used.length - metered.length) : null}
      />
      <StatTile
        label={words.stat.probe}
        value={share === null ? null : formatRate(share)}
        tone={share === null ? undefined : dead > 0 ? 'sev' : 'ok'}
        sub={share === null ? null : words.probeSub(dead)}
      />
      <StatTile
        label={words.stat.customers}
        value={ready ? formatTally(customers) : null}
        sub={ready ? words.customersSub : null}
      />
    </div>
  );
}
