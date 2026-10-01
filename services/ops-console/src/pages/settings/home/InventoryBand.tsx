import { StatTile } from '@/components/ops/StatTile';
import { copy } from '@/copy/copy';
import { formatRate, formatTally } from '@/lib/display';
import { probeShare, type ExitState } from '@/lib/residential';
import type { HomeExit } from '@/lib/settings-legacy';

const words = copy.residential.inventory;

/**
 * Six numbers over the inventory: how many lines, how many are carrying
 * customers, how many could be but are not, how many the prober cannot
 * reach, how many are switched off, and how often the probes get through.
 * `null` rows (a read that has not answered) leave every tile a dash.
 */
export function InventoryBand({
  rows,
  stateOf,
  boundOf,
}: {
  rows: readonly HomeExit[] | null;
  stateOf: (row: HomeExit) => ExitState;
  boundOf: (row: HomeExit) => number;
}) {
  const ready = rows !== null;
  const all = rows ?? [];
  const count = (state: ExitState) => all.filter((row) => stateOf(row) === state).length;
  const dead = all.filter((row) => stateOf(row) === 'dead');
  const carrying = dead.filter((row) => boundOf(row) > 0).length;
  const customers = all.reduce((sum, row) => sum + (stateOf(row) === 'bound' ? boundOf(row) : 0), 0);
  const active = all.filter((row) => row.status === 'active');
  const probed = active.filter((row) => row.probeTotal !== null && row.probeTotal > 0);
  const share = probeShare(active.map((row) => ({ alive: row.probeAlive, total: row.probeTotal })));
  const socks = all.filter((row) => row.kind === 'socks5').length;
  const idle = count('idle');

  return (
    <div className="home-stats">
      <StatTile
        label={words.stat.lines}
        value={ready ? formatTally(all.length) : null}
        sub={ready ? words.linesSub(socks, all.length - socks) : null}
      />
      <StatTile
        label={words.stat.bound}
        value={ready ? formatTally(count('bound')) : null}
        sub={ready ? words.boundSub(customers) : null}
      />
      <StatTile
        label={words.stat.idle}
        value={ready ? formatTally(idle) : null}
        tone={ready && idle > 0 ? 'warn' : undefined}
        sub={ready ? words.idleSub : null}
      />
      <StatTile
        label={words.stat.dead}
        value={ready ? formatTally(dead.length) : null}
        tone={ready ? (dead.length > 0 ? 'sev' : 'ok') : undefined}
        sub={ready ? words.deadSub(carrying) : null}
      />
      <StatTile
        label={words.stat.off}
        value={ready ? formatTally(count('off')) : null}
        sub={ready ? words.offSub : null}
      />
      <StatTile
        label={words.stat.probe}
        value={share === null ? null : formatRate(share)}
        sub={share === null ? null : words.probeSub(probed.length)}
      />
    </div>
  );
}
