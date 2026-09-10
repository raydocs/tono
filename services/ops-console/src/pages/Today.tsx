import { useMemo, useState } from 'react';
import type { CustomerSummaryDto, FunnelDto, IncidentDto, ReleaseDto, SystemHealthDto } from '@contract';
import { Action } from '@/components/ops/Action';
import { CountText } from '@/components/ops/CountText';
import { Empty } from '@/components/ops/Empty';
import { PageNote } from '@/components/ops/PageNote';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import { followupApi } from '@/lib/api-followups';
import { customerChores, fleetChores, inviteChores, sortChores } from '@/lib/chores';
import { severityTone } from '@/lib/codes';
import { formatDurationSince, formatWhen, formatWhenAgo } from '@/lib/display';
import { invitesOf } from '@/lib/funnel';
import { choresDueToday, closureWord, recoveredCount } from '@/lib/handling';
import { openIncident } from '@/lib/hash-route';
import {
  impactedCustomers,
  incidentAction,
  incidentSubject,
  lastResolvedAt,
  openIncidents,
  resolvedIncidents,
} from '@/lib/incidents';
import { minSupportedVersions } from '@/lib/releases';
import { usePrivacy } from '@/lib/privacy';
import type { FleetNodeDto } from '@/lib/types';
import { newestFetch, useResource, type Resource } from '@/lib/use-resource';
import { cn } from '@/lib/utils';
import { ChoreList } from './today/Chores';
import { CloseDialog } from './today/CloseDialog';
import { Digest } from './today/Digest';
import { IncidentPrimary } from './today/IncidentAction';
import { IncidentDrawer } from './today/IncidentDrawer';

const TABS = ['open', 'resolved', 'chores'] as const;
type TabId = (typeof TABS)[number];

export default function TodayPage({
  incidents,
  customers,
  funnel,
  health,
  releases,
  nodes,
  selected,
  onChanged,
}: {
  incidents: Resource<IncidentDto[]>;
  customers: Resource<CustomerSummaryDto[]>;
  /** The people who have not started yet: the other half of the onboarding chores. */
  funnel: Resource<FunnelDto>;
  health: Resource<SystemHealthDto>;
  releases: Resource<ReleaseDto[]>;
  nodes: FleetNodeDto[];
  selected: string | null;
  onChanged: () => void;
}) {
  const privacy = usePrivacy();
  const [tab, setTab] = useState<TabId>('open');

  const all = useMemo(
    () => (incidents.status === 'ready' ? incidents.data : []),
    [incidents],
  );
  const open = useMemo(() => openIncidents(all), [all]);
  const resolved = useMemo(() => resolvedIncidents(all), [all]);
  const people = useMemo(
    () => (customers.status === 'ready' ? customers.data : []),
    [customers],
  );
  const floors = useMemo(
    () => (releases.status === 'ready' ? minSupportedVersions(releases.data) : {}),
    [releases],
  );
  /**
   * The chores are one list, and the onboarding half arrives from two places: the
   * customers who registered and stopped, and the addresses that were opened
   * and never registered at all. They are counted here rather than in either
   * list, so the tab, the morning read and the rows below cannot disagree
   * about how much is owed today (R4).
   */
  const invites = useMemo(
    () => invitesOf(funnel.status === 'ready' ? funnel.data : null),
    [funnel],
  );
  const chores = useMemo(
    () => sortChores([
      ...fleetChores(nodes),
      ...customerChores(people, privacy.email, floors),
      ...inviteChores(invites, privacy.email),
    ]),
    [nodes, people, privacy, floors, invites],
  );

  /**
   * The recovered tab counts recoveries, and a rule that fired wrongly is not
   * one. The mistaken rows stay in the list — losing them would lose the
   * evidence that the rule needs changing — but they are out of the number.
   */
  const counts: Record<TabId, number> = {
    open: open.length,
    resolved: recoveredCount(resolved),
    chores: chores.length,
  };

  const digest = useResource('digest', (signal) => followupApi.digest(signal));

  return (
    <div className="page-wrap">
      {incidents.status === 'ready' ? (
        <p className="text-verdict">
          {open.length > 0 ? (
            <CountText
              values={[open.length, impactedCustomers(all)]}
              render={(values) => copy.todayVerdict(values[0], values[1])}
            />
          ) : clearSentence(all)}
        </p>
      ) : (
        <p className="text-verdict text-[var(--muted-foreground)]">
          {incidents.status === 'loading' ? copy.loading : copy.loadError}
        </p>
      )}

      <PageNote
        fetchedAt={newestFetch(incidents, customers, health)}
        backfill={health.status === 'ready' ? health.data.backfill : null}
      />

      {/* The morning read sits under the sentence and above the lists, in the
          review's order: what the night did, what is waiting, what falls due
          today. Every line lands somewhere the reader can act. */}
      <Digest
        digest={digest}
        openCount={open.length}
        choresToday={choresDueToday(chores).length}
        onShowOpen={() => setTab('open')}
        onShowResolved={() => setTab('resolved')}
        onShowChores={() => setTab('chores')}
      />

      <div className="flex items-center gap-5 border-b border-[var(--hairline)] text-body">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cn('ops-tab', id === 'chores' && 'ops-tab-rem')}
            onClick={() => setTab(id)}
          >
            {copy.todayTabs[id]}
            <span className="ml-1.5 font-mono text-micro">{copy.tabCount(counts[id])}</span>
          </button>
        ))}
      </div>

      {incidents.status !== 'ready' ? (
        <Empty message={incidents.status === 'loading' ? copy.loading : incidents.message || copy.loadError} />
      ) : tab === 'chores' ? (
        <ChoreList rows={chores} />
      ) : (
        <IncidentList
          rows={tab === 'open' ? open : resolved}
          resolvedTab={tab === 'resolved'}
          emptyMessage={tab === 'open' ? copy.emptyIncidents : copy.emptyResolved}
          subjectOf={(row) => incidentSubject(row, people, privacy.email) ?? copy.missing}
          onChanged={onChanged}
        />
      )}

      <IncidentDrawer
        id={selected}
        incidents={all}
        customers={people}
        onChanged={onChanged}
      />
    </div>
  );
}

function clearSentence(all: readonly IncidentDto[]): string {
  const at = lastResolvedAt(all);
  return at === null ? copy.todayNeverAny : copy.todayClear(formatWhenAgo(at));
}

function IncidentList({
  rows,
  resolvedTab,
  emptyMessage,
  subjectOf,
  onChanged,
}: {
  rows: readonly IncidentDto[];
  resolvedTab: boolean;
  emptyMessage: string;
  subjectOf: (row: IncidentDto) => string;
  onChanged: () => void;
}) {
  if (rows.length === 0) return <Empty message={emptyMessage} />;
  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <IncidentRow
          key={row.id}
          row={row}
          subject={subjectOf(row)}
          resolvedTab={resolvedTab}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

/**
 * One incident, one sentence, and the thing worth doing about it.
 *
 * The row is a button so the whole line opens the drawer from a keyboard, and
 * the actions inside it stop the click from bubbling — on a phone the targets
 * are a thumb apart, and opening a drawer when someone meant to acknowledge is
 * the kind of misfire that ends with the alert being ignored.
 *
 * Claiming is the second button now. It changes nothing about the fault, and
 * while it was the only one on every row the page could report a blocked node
 * and offer no way to do anything about it.
 */
function IncidentRow({
  row,
  subject,
  resolvedTab,
  onChanged,
}: {
  row: IncidentDto;
  subject: string;
  resolvedTab: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [closing, setClosing] = useState(false);
  const open = row.status === 'open';
  const led = incidentAction(row) !== null;

  /**
   * Claiming still fires on the click — it changes nothing about the fault.
   * Closing does not: it now has to say whether the thing was measured working
   * again, was never broken, or is simply no longer being chased.
   */
  async function act() {
    setPending(true);
    try {
      await opsApi.ackIncident(row.id);
      onChanged();
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className="incident-row"
      onClick={() => openIncident(row.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openIncident(row.id);
        }
      }}
    >
      <span className={cn('sev-rail', `tone-${severityTone(row.severity)}`)} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-micro text-[var(--muted-foreground)]">{copy.severity[row.severity]}</span>
          <span className="min-w-0 truncate font-mono text-body text-[var(--muted-foreground)]">
            {subject}
          </span>
        </div>
        <p className="text-row">{row.title}</p>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-micro text-[var(--muted-foreground)]">
          <span>{copy.incidentImpact(row.impactCount)}</span>
          {/* Recovered, mistaken, or merely dropped: the row says which of
              the three ended it, because only the first means a customer can
              use the thing again. */}
          <span>
            {resolvedTab ? closureWord(row) : copy.incidentOpenFor}{' '}
            <span className="font-mono normal-case tracking-normal">
              {resolvedTab
                ? formatWhenAgo(row.resolvedAt)
                : formatDurationSince(row.openedAt)}
            </span>
          </span>
          <span title={formatWhen(row.lastSeenAt)}>
            {copy.incidentLastSeen}{' '}
            <span className="font-mono normal-case tracking-normal">{formatWhenAgo(row.lastSeenAt)}</span>
          </span>
        </div>
      </div>
      {resolvedTab ? null : (
        <div
          className="flex shrink-0 flex-wrap items-start justify-end gap-2"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          role="presentation"
        >
          <IncidentPrimary incident={row} onChanged={onChanged} />
          {open ? (
            <Action primary={!led} pending={pending} onClick={act}>
              {copy.incidentPrimary.ack}
            </Action>
          ) : (
            <Action primary={!led} onClick={() => setClosing(true)}>
              {copy.incidentPrimary.resolve}
            </Action>
          )}
          <CloseDialog
            incident={row}
            open={closing}
            onClose={() => setClosing(false)}
            onChanged={onChanged}
          />
        </div>
      )}
    </div>
  );
}
