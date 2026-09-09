import { ArrowLeft } from 'lucide-react';
import type { CustomerBillingDto, CustomerNowDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { Fact } from '@/components/ops/DetailDrawer';
import { Empty } from '@/components/ops/Empty';
import { HeatStrip } from '@/components/ops/HeatStrip';
import { QuotaBar } from '@/components/ops/QuotaGauge';
import { FoldedSection, Section } from '@/components/ops/Section';
import { StatusWord } from '@/components/ops/StatusWord';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import { formatDate, formatPercent, formatWhenAgo, splitBytes } from '@/lib/display';
import { closeCustomer } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { shown } from '@/lib/sources';
import { useResource } from '@/lib/use-resource';
import { measured, type Measured } from '@/components/ops/measured';
import { CarrierMatrix } from './customer/CarrierMatrix';
import { Destinations } from './customer/Destinations';
import { Devices } from './customer/Devices';
import { ServiceUsage } from './customer/Services';
import { Timeline } from './customer/Timeline';

const RANGE = '7d' as const;
/** Every action on this header needs a write endpoint the console has not been given yet. */
const HEADER_ACTIONS = [
  copy.customerActions.diagnose,
  copy.customerActions.resend,
  copy.customerActions.changeExpiry,
  copy.customerActions.suspend,
];

export default function CustomerDetailPage({ userId }: { userId: string }) {
  const privacy = usePrivacy();
  const detail = useResource(userId, (signal) => opsApi.customer(userId, signal));
  const connections = useResource(userId, (signal) => opsApi.customerConnections(userId, signal));
  const activity = useResource(userId, (signal) => opsApi.customerActivity(userId, RANGE, signal));
  const destinations = useResource(userId, (signal) => opsApi.customerDestinations(userId, RANGE, signal));
  const services = useResource(userId, (signal) => opsApi.customerServices(userId, RANGE, signal));

  if (detail.status !== 'ready') {
    return (
      <div className="page-wrap">
        <BackLink />
        <Empty message={detail.status === 'loading' ? copy.loading : detail.message || copy.loadError} />
      </div>
    );
  }

  const row = detail.data;
  const events = connections.status === 'ready' ? connections.data.items : [];

  return (
    <div className="page-wrap">
      <BackLink />

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-verdict">{privacy.email(row.email)}</h1>
          <StatusWord word={row.health} reason={row.reason} />
          <span className="ops-tag">{copy.lifecycle[row.lifecycle]}</span>
        </div>
        {row.reason ? (
          <p className="text-body text-[var(--muted-foreground)]">{row.reason}</p>
        ) : null}
        <div className="grid gap-5 border-y border-[var(--hairline)] py-4 sm:grid-cols-2">
          <Fact
            label={copy.expiresAt}
            measured={measured(
              row.billing.expiresAt === null ? null : formatDate(row.billing.expiresAt),
              row.billing.expiresAt,
              copy.sourceWord.profile,
            )}
          />
          <Quota billing={row.billing} />
        </div>
        <ActionRow>
          {HEADER_ACTIONS.map((label) => (
            <Action key={label} reason={copy.customerActions.blocked}>{label}</Action>
          ))}
        </ActionRow>
      </header>

      <Section title={copy.customerSections.now}>
        <div className="grid gap-x-8 sm:grid-cols-2">
          {nowFacts(row.now).map((fact) => (
            <Fact key={fact.label} label={fact.label} measured={fact.measured} />
          ))}
        </div>
      </Section>

      <Timeline
        events={events}
        devices={row.devices}
        state={connections.status}
        message={connections.status === 'error' ? connections.message : undefined}
      />

      <Section
        title={copy.customerSections.activity}
        aside={<span className="text-micro text-[var(--muted-foreground)]">{copy.timelineFilters.week}</span>}
      >
        {activity.status === 'ready' ? (
          <HeatStrip rows={activity.data.items} source={copy.sourceWord.telemetry} />
        ) : (
          <Empty message={activity.status === 'loading' ? copy.loading : copy.loadError} />
        )}
      </Section>

      <Destinations
        rows={destinations.status === 'ready' ? destinations.data.items : []}
        state={destinations.status}
        message={destinations.status === 'error' ? destinations.message : undefined}
      />

      <ServiceUsage
        rows={services.status === 'ready' ? services.data.items : []}
        state={services.status}
        message={services.status === 'error' ? services.message : undefined}
      />

      <CarrierMatrix events={events} />

      <Devices devices={row.devices} />

      <FoldedSection title={copy.customerSections.diagnostics}>
        <Empty message={copy.noDiagnostics} />
      </FoldedSection>

      <FoldedSection title={copy.customerSections.chores} count={row.chores.length}>
        {row.chores.length === 0 ? (
          <Empty message={copy.noChores} />
        ) : (
          <ul className="flex flex-col">
            {row.chores.map((chore) => (
              <li
                key={chore.id}
                className="flex items-baseline justify-between gap-4 border-b border-[var(--hairline)] py-2 last:border-b-0"
              >
                <span className="tone-rem ops-tag">{choreWord(chore.kind)}</span>
                <span className="mr-auto min-w-0 truncate text-body">{chore.summary}</span>
                <span className="shrink-0 font-mono text-micro text-[var(--muted-foreground)]">
                  {chore.dueAt === null ? copy.missing : formatDate(chore.dueAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </FoldedSection>

      <FoldedSection title={copy.customerSections.billing}>
        <div className="grid gap-x-8 sm:grid-cols-2">
          <Fact
            label={copy.billingFacts.plan}
            measured={measured(row.billing.plan, row.updatedAt, copy.sourceWord.profile)}
          />
          <Fact
            label={copy.billingFacts.deviceLimit}
            measured={measured(String(row.billing.deviceLimit), row.updatedAt, copy.sourceWord.profile)}
          />
          <Fact
            label={copy.billingFacts.since}
            measured={measured(
              row.billing.firstEntitledAt === null ? null : formatDate(row.billing.firstEntitledAt),
              row.billing.firstEntitledAt,
              copy.sourceWord.profile,
            )}
          />
          <Fact
            label={copy.billingFacts.expires}
            measured={measured(
              row.billing.expiresAt === null ? null : formatDate(row.billing.expiresAt),
              row.billing.expiresAt,
              copy.sourceWord.profile,
            )}
          />
        </div>
      </FoldedSection>
    </div>
  );
}

/**
 * Used, capped, and how much is left — without the node page's exhaustion
 * forecast. That forecast needs a cycle start, a customer record has none, and
 * feeding it the first-entitlement date produced a confident exhaustion date
 * two years out: a projection with nothing behind it is worse than none.
 */
function Quota({ billing }: { billing: CustomerBillingDto }) {
  const usage = shown(billing.usageBytes);
  const quota = billing.quotaBytes;
  const used = usage.value === null ? null : splitBytes(usage.value);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-micro text-[var(--muted-foreground)]">{copy.quota}</span>
      {used === null || quota === null || quota <= 0 ? (
        <Value value={used === null ? null : `${used.number} ${used.unit}`} source={usage.source} mono />
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-row">
              {used.number}
              <span className="ml-1 text-micro font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
                {used.unit} / {splitBytes(quota).number} {splitBytes(quota).unit}
              </span>
            </span>
            <span className="font-mono text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
              {copy.remaining}{' '}
              {quota - (usage.value ?? 0) < 0
                ? copy.overQuota
                : formatPercent((quota - (usage.value ?? 0)) / quota)}
            </span>
          </div>
          <QuotaBar used={usage.value} quota={quota} />
        </>
      )}
    </div>
  );
}

/**
 * The "now" block, as six measured facts.
 *
 * They all hang off the same stamp — `now.connected.asOfSec` — because they
 * are one read of one client's state, and dating "which node" differently
 * from "connected at all" would invite the reading that the node is current
 * while the connection is stale.
 */
function nowFacts(now: CustomerNowDto): Array<{ label: string; measured: Measured<string | null> }> {
  const at = now.connected.asOfSec;
  const stamp = (value: string | null): Measured<string | null> =>
    measured(at === null ? null : value, at, copy.sourceWord.telemetry);
  const version = [now.appVersion, now.osVersion].filter(Boolean).join(' · ');
  const carrier = [now.carrier, now.region].filter(Boolean).join(' · ');
  return [
    { label: copy.now.connected, measured: stamp(now.connected.value ? copy.now.yes : copy.now.no) },
    { label: copy.now.node, measured: stamp(now.node) },
    {
      label: copy.now.since,
      measured: measured(
        now.connectedSince === null ? null : formatWhenAgo(now.connectedSince),
        now.connectedSince,
        copy.sourceWord.telemetry,
      ),
    },
    { label: copy.now.device, measured: stamp(now.deviceId) },
    { label: copy.now.version, measured: stamp(version || null) },
    { label: copy.now.carrier, measured: stamp(carrier || null) },
  ];
}

/** The kind is a free string on the wire; anything unmapped reads as a plain chore. */
function choreWord(kind: string): string {
  const known = copy.choreKind as Record<string, string>;
  return known[kind] ?? copy.choreKindOther;
}

function BackLink() {
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 self-start text-micro text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      onClick={closeCustomer}
    >
      <ArrowLeft size={12} strokeWidth={1.75} />
      {copy.pages.customers}
    </button>
  );
}
