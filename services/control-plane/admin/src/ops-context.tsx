import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { operationsApi, type DashboardDto, type MetricsDto } from './api';
import { useRefresh, useResource, type Live } from './hooks';
import { parseOpsHash, parseTrafficRange } from './lib/hash';
import { accidentsOnly, choresOnly, incidentsFromWorld, type OpsIncident } from './lib/incidents';
import { assembleOpsNodes, assembleOpsPeople, type OpsNodeView, type OpsPersonView } from './lib/ops-views';

export type OpsWorld = {
  dashboard: Live<DashboardDto>;
  live: Live<Awaited<ReturnType<typeof operationsApi.live>>>;
  profiles: Live<Awaited<ReturnType<typeof operationsApi.nodeProfiles>>>;
  activity: Live<Awaited<ReturnType<typeof operationsApi.activity>>>;
  catalog: Live<Awaited<ReturnType<typeof operationsApi.exitCatalog>>>;
  fleet: Live<Awaited<ReturnType<typeof operationsApi.fleetNodes>>>;
  users: Live<Awaited<ReturnType<typeof operationsApi.users>>>;
  audit: Live<Awaited<ReturnType<typeof operationsApi.audit>>>;
  metrics: Live<MetricsDto>;
  nodes: OpsNodeView[];
  people: OpsPersonView[];
  incidents: OpsIncident[];
  accidents: OpsIncident[];
  chores: OpsIncident[];
  catalogRevision: number | null;
  nowSec: number;
};

const OpsContext = createContext<OpsWorld | null>(null);

function cadence(pulse: number, floor: number) {
  if (!pulse) return 0;
  return Math.max(pulse, floor);
}

export function OpsDataProvider({ children }: { children: ReactNode }) {
  const { refreshMs } = useRefresh();
  const [page, setPage] = useState(() => parseOpsHash(window.location.hash).page);
  const [metricsRange, setMetricsRange] = useState(() => parseTrafficRange(parseOpsHash(window.location.hash).range));
  useEffect(() => {
    const sync = () => {
      const hash = parseOpsHash(window.location.hash);
      setPage(hash.page);
      setMetricsRange(parseTrafficRange(hash.range));
    };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const fast = refreshMs;
  const minute = cadence(refreshMs, 60_000);
  const slow = cadence(refreshMs, 120_000);
  const wantMetrics = page === 'traffic' || page === 'monitor';
  const range = page === 'traffic' ? metricsRange : '24h';

  const dashboard = useResource(operationsApi.dashboard, [], minute);
  const live = useResource(operationsApi.live, [], fast);
  const profiles = useResource(operationsApi.nodeProfiles, [], slow);
  const activity = useResource(operationsApi.activity, [], fast);
  const catalog = useResource(operationsApi.exitCatalog, [], slow);
  const fleet = useResource(operationsApi.fleetNodes, [], fast);
  const users = useResource(operationsApi.users, [], minute);
  const audit = useResource(operationsApi.audit, [], slow);
  const metrics = useResource(() => operationsApi.metrics(range), [range], wantMetrics ? minute : 0, wantMetrics);

  const world = useMemo(() => {
    const clock = Math.floor(Date.now() / 1000);
    const liveReady = live.state === 'ready';
    const nodes = assembleOpsNodes({
      catalogYaml: catalog.state === 'ready' ? catalog.data.yaml : null,
      catalogSource: catalog.state === 'ready' ? 'ready' : catalog.state === 'error' ? 'unavailable' : 'loading',
      qualityNodes: liveReady ? live.data.quality?.nodes : null,
      qualitySource: !liveReady
        ? (live.state === 'error' ? 'unavailable' : 'loading')
        : (live.data.qualityError && live.data.quality == null ? 'unavailable' : 'ready'),
      agents: liveReady ? live.data.agents : null,
      agentSource: !liveReady
        ? (live.state === 'error' ? 'unavailable' : 'loading')
        : (live.data.agentsError && live.data.agents == null ? 'unavailable' : 'ready'),
      profiles: profiles.state === 'ready' ? profiles.data : null,
      activity: activity.state === 'ready' ? activity.data.users : null,
      activitySource: activity.state === 'ready' ? 'ready' : activity.state === 'error' ? 'unavailable' : 'loading',
      nowMs: Date.now(),
    });
    const people = assembleOpsPeople({
      users: users.state === 'ready' ? users.data : null,
      activity: activity.state === 'ready' ? activity.data.users : null,
      telemetrySource: activity.state === 'ready' ? 'ready' : activity.state === 'error' ? 'unavailable' : 'loading',
      catalogRevision: catalog.state === 'ready' ? catalog.data.revision : null,
      nowSec: clock,
    });
    const catalogRevision = catalog.state === 'ready' ? catalog.data.revision : null;
    const incidents = incidentsFromWorld({ nodes, people, catalogRevision, nowSec: clock });
    return {
      nodes,
      people,
      incidents,
      accidents: accidentsOnly(incidents),
      chores: choresOnly(incidents),
      catalogRevision,
      nowSec: clock,
    };
  }, [
    live.state, live.refreshedAt,
    profiles.state, profiles.refreshedAt,
    activity.state, activity.refreshedAt,
    catalog.state, catalog.refreshedAt,
    users.state, users.refreshedAt,
  ]);

  const value: OpsWorld = {
    dashboard, live, profiles, activity, catalog, fleet, users, audit, metrics,
    ...world,
  };

  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>;
}

export function useOpsWorld(): OpsWorld {
  const value = useContext(OpsContext);
  if (!value) throw new Error('useOpsWorld must be used inside OpsDataProvider');
  return value;
}
