import type { CustomerDetailDto } from '@contract';
import type { Measured } from '@/components/ops/measured';
import { measured } from '@/components/ops/measured';
import type { Tier } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { formatWhenAgo } from '@/lib/display';
import { stageSentence } from '@/lib/funnel';

/**
 * The "now" block, as six measured facts on the card's three tiers.
 *
 * They all hang off the same stamp — `now.connected.asOfSec` — because they
 * are one read of one client's state, and dating "which node" differently
 * from "connected at all" would invite the reading that the node is current
 * while the connection is stale.
 *
 * The tiers are the answer's shape: whether they are on and where, then the
 * facts that qualify it, then the device id — an opaque token nobody reads
 * unless they are about to type it somewhere.
 *
 * For somebody who has never connected, the first line is not the connected
 * word — that one says a client which works has stopped, and this client has
 * never started.
 * It is the step they are stuck on and how long they have been on it, which is
 * the only thing on this page anybody can act on. The header keeps the health
 * word: what to think is one axis, what to do is another.
 */
export function nowFacts(row: CustomerDetailDto): Array<{
  label: string;
  measured: Measured<string | null>;
  tier: Tier;
}> {
  const now = row.now;
  const at = now.connected.asOfSec;
  const stamp = (value: string | null): Measured<string | null> =>
    measured(at === null ? null : value, at, copy.sourceWord.telemetry);
  const version = [now.appVersion, now.osVersion].filter(Boolean).join(' · ');
  const carrier = [now.carrier, now.region].filter(Boolean).join(' · ');
  const started = row.stage === 'connected';
  return [
    started ? {
      label: copy.now.connected,
      measured: stamp(now.connected.value ? copy.now.yes : copy.now.no),
      tier: 'row',
    } : {
      label: copy.now.stage,
      measured: measured(
        stageSentence(row.stage, row.stageSinceAt),
        row.stageSinceAt,
        copy.sourceWord.engine,
      ),
      tier: 'row',
    },
    { label: copy.now.node, measured: stamp(now.node), tier: 'row' },
    {
      label: copy.now.since,
      measured: measured(
        now.connectedSince === null ? null : formatWhenAgo(now.connectedSince),
        now.connectedSince,
        copy.sourceWord.telemetry,
      ),
      tier: 'body',
    },
    { label: copy.now.version, measured: stamp(version || null), tier: 'body' },
    { label: copy.now.carrier, measured: stamp(carrier || null), tier: 'body' },
    { label: copy.now.device, measured: stamp(now.deviceId), tier: 'fine' },
  ];
}
