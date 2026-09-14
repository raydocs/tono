import { useMemo, useState } from 'react';
import type { CustomerSummaryDto, FunnelDto, IncidentDto, ReleaseDto, SystemHealthDto } from '@contract';
import { CountText } from '@/components/ops/CountText';
import { Empty } from '@/components/ops/Empty';
import { PageNote } from '@/components/ops/PageNote';
import { copy } from '@/copy/copy';
import { followupApi } from '@/lib/api-followups';
import { customerChores, fleetChores, inviteChores, sortChores } from '@/lib/chores';
import { formatWhenAgo } from '@/lib/display';
import { invitesOf } from '@/lib/funnel';
import { choresDueToday, recoveredCount } from '@/lib/handling';
import { coverageLine } from '@/lib/health';
import {
  impactedCustomers,
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
import '@/styles/today.css';
import { ChoreList } from './today/Chores';
import { Digest } from './today/Digest';
import { HeroKpis } from './today/HeroKpis';
import { IncidentList } from './today/IncidentCard';
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
  fleetReady,
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
  /** Whether the fleet read behind `nodes` landed: fleet chores are part of
      the due-today number, so without this the hero would print a partial sum
      as if it were the whole day. */
  fleetReady: boolean;
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
  const coverage = useMemo(
    () => coverageLine(health.status === 'ready' ? health.data : null),
    [health],
  );

  /**
   * The hero numbers, each in its own caliber and each null-aware. A resource
   * that has not landed renders a dash: the tab counts below may read zero
   * while loading (their long-standing behavior, untouched here), but the hero
   * must not print a calm nobody measured.
   */
  const incidentsReady = incidents.status === 'ready';
  const choresReady = customers.status === 'ready'
    && funnel.status === 'ready'
    && releases.status === 'ready';
  const kpiOpen = incidentsReady ? open.length : null;
  const kpiImpacted = incidentsReady ? impactedCustomers(all) : null;
  const kpiDue = choresReady && fleetReady && digest.status === 'ready'
    ? choresDueToday(chores).length
      + digest.data.due.followups.length
      + digest.data.due.checks.length
    : null;
  const swept = health.status === 'ready' ? health.data.coverage ?? null : null;

  return (
    <div className="page-wrap today-page">
      <section className="today-hero" aria-label={copy.pages.today}>
        <div className="min-w-0">
          {coverage ? (
            <span className={cn('today-hero-eyebrow text-fine', coverage.tone && `tone-${coverage.tone} tone-fg`)}>
              {coverage.text}
            </span>
          ) : null}

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
            className="today-hero-note"
            fetchedAt={newestFetch(incidents, customers, health)}
            backfill={health.status === 'ready' ? health.data.backfill : null}
          />
        </div>

        <HeroKpis
          open={kpiOpen}
          impacted={kpiImpacted}
          due={kpiDue}
          swept={swept === null || swept === undefined ? null : swept.nodesSweptFresh}
          listed={swept === null || swept === undefined ? null : swept.nodesListed}
          sweptTone={swept === null || swept === undefined || coverage?.tone === 'unk' ? 'unk' : 'ok'}
        />
      </section>

      <div className="today-grid">
        <div className="today-aux">
          {/* The morning read sits in the aux column on desktop and folds shut
              on a phone, in the review's order: what the night did, what is
              waiting, what falls due today. Every line lands somewhere the
              reader can act. */}
          <Digest
            digest={digest}
            openCount={open.length}
            choresToday={choresDueToday(chores).length}
            onShowOpen={() => setTab('open')}
            onShowResolved={() => setTab('resolved')}
            onShowChores={() => setTab('chores')}
          />
        </div>

        <div className="today-main">
          {/* Three tabs, one line, always: on a phone the strip scrolls sideways
              rather than wrapping, because a tab row that reflows every time a
              count changes moves the list the thumb was aiming at. */}
          <div className="today-tabs text-body">
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

          <div className="today-list-wrap">
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
          </div>
        </div>
      </div>

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
