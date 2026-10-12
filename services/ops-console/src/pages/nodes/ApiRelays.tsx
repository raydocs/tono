import type { ApiRelayDto, ApiRelayEndToEndDto, ApiRelaysDto } from '@contract';
import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { StatusWord, type Tone } from '@/components/ops/StatusWord';
import { copy } from '@/copy/copy';
import { nowSec } from '@/lib/clock';
import { formatLatency, formatWhenAgo } from '@/lib/display';
import type { Resource } from '@/lib/use-resource';

/** Three missed five-minute reports: the node's last word no longer says anything about now. */
export const END_TO_END_STALE_SEC = 15 * 60;

/**
 * The Tono-owned API relays (decision 077), one line each, two verdicts:
 *
 * - TCP reachable: the Worker cron opened the port. It cannot set SNI, so this
 *   only says the port answered.
 * - End to end: the relay node's own full HTTPS request through its local relay,
 *   certificate checked, with the report's age. A report older than
 *   {@link END_TO_END_STALE_SEC} is grey "stale", never green.
 *
 * Nothing measured yet is grey, not red; a failure carries its error on hover.
 */
export function ApiRelays({ relays }: { relays: Resource<ApiRelaysDto> }) {
  return (
    <Section title={copy.apiRelays.title}>
      <p className="text-fine text-[var(--muted-foreground)]">{copy.apiRelays.lead}</p>
      {relays.status === 'loading' ? <Empty message={copy.loading} /> : null}
      {relays.status === 'error' ? <Empty message={copy.apiRelays.loadFailed} /> : null}
      {relays.status === 'ready' ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] items-baseline">
          <span />
          <span className="text-micro text-[var(--muted-foreground)]">{copy.apiRelays.tcpColumn}</span>
          <span className="text-micro text-[var(--muted-foreground)]">{copy.apiRelays.e2eColumn}</span>
          {relays.data.relays.map((relay) => <RelayLine key={`${relay.host}:${relay.port}`} relay={relay} />)}
        </div>
      ) : null}
    </Section>
  );
}

const CELL = 'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-[var(--hairline)] py-2 pr-4';
const AGE = 'font-mono text-micro text-[var(--muted-foreground)]';

function RelayLine({ relay }: { relay: ApiRelayDto }) {
  const tone: Tone = relay.ok === null ? 'unk' : relay.ok ? 'ok' : 'sev';
  const word = relay.ok === null ? copy.apiRelays.unchecked : relay.ok ? copy.apiRelays.up : copy.apiRelays.down;
  return (
    <>
      <span className={`${CELL} text-row`}>{relay.name}</span>
      <span className={CELL}>
        <StatusWord word={word} tone={tone} reason={relay.error} />
        {relay.ok ? <span className="font-mono text-micro">{formatLatency(relay.latencyMs)}</span> : null}
        {relay.checkedAt === null ? null : <span className={AGE}>{copy.apiRelays.checked(formatWhenAgo(relay.checkedAt))}</span>}
      </span>
      <EndToEndCell report={relay.endToEnd} />
    </>
  );
}

function EndToEndCell({ report }: { report: ApiRelayEndToEndDto | undefined }) {
  if (!report) {
    return (
      <span className={CELL}>
        <StatusWord word={copy.apiRelays.e2eNone} tone="unk" />
      </span>
    );
  }
  const stale = nowSec() - report.observedAt > END_TO_END_STALE_SEC;
  const tone: Tone = stale ? 'unk' : report.ok ? 'ok' : 'sev';
  const word = stale ? copy.apiRelays.e2eStale : report.ok ? copy.apiRelays.e2eUp : copy.apiRelays.e2eDown;
  return (
    <span className={CELL}>
      <StatusWord word={word} tone={tone} reason={report.error} />
      {report.ok && !stale ? <span className="font-mono text-micro">{formatLatency(report.latencyMs)}</span> : null}
      <span className={AGE}>{copy.apiRelays.reported(formatWhenAgo(report.observedAt))}</span>
    </span>
  );
}
