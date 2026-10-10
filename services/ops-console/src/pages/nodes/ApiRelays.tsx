import type { ApiRelayDto, ApiRelaysDto } from '@contract';
import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { StatusWord, type Tone } from '@/components/ops/StatusWord';
import { copy } from '@/copy/copy';
import { formatLatency, formatWhenAgo } from '@/lib/display';
import type { Resource } from '@/lib/use-resource';

/**
 * The Tono-owned API relays (decision 077), one line each: reachable or not,
 * how fast the port answered, and when the cron last looked.
 *
 * The check is a TCP open from the Worker, so "reachable" means the port
 * answered; the lead says so, and a failing relay carries its error on hover.
 * A relay the cron has not reached yet is grey, not red.
 */
export function ApiRelays({ relays }: { relays: Resource<ApiRelaysDto> }) {
  return (
    <Section title={copy.apiRelays.title}>
      <p className="text-fine text-[var(--muted-foreground)]">{copy.apiRelays.lead}</p>
      {relays.status === 'loading' ? <Empty message={copy.loading} /> : null}
      {relays.status === 'error' ? <Empty message={copy.apiRelays.loadFailed} /> : null}
      {relays.status === 'ready'
        ? relays.data.relays.map((relay) => <RelayLine key={`${relay.host}:${relay.port}`} relay={relay} />)
        : null}
    </Section>
  );
}

function RelayLine({ relay }: { relay: ApiRelayDto }) {
  const tone: Tone = relay.ok === null ? 'unk' : relay.ok ? 'ok' : 'sev';
  const word = relay.ok === null ? copy.apiRelays.unchecked : relay.ok ? copy.apiRelays.up : copy.apiRelays.down;
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[var(--hairline)] py-2 last:border-b-0">
      <span className="text-row">{relay.name}</span>
      <StatusWord word={word} tone={tone} reason={relay.error} />
      {relay.ok ? <span className="font-mono text-micro">{formatLatency(relay.latencyMs)}</span> : null}
      {relay.checkedAt === null ? null : (
        <span className="ml-auto font-mono text-micro text-[var(--muted-foreground)]">
          {copy.apiRelays.checked(formatWhenAgo(relay.checkedAt))}
        </span>
      )}
    </div>
  );
}
