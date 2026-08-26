import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { operationsApi, type DashboardDto, type MetricsDto } from './api';
import { useKeyedResource, useRefresh, useResource, type KeyedLive, type Live } from './hooks';
import { parseOpsHash, parseTrafficRange, type TrafficRange } from './lib/hash';
import { accidentsOnly, choresOnly, incidentsFromWorld, type OpsIncident } from './lib/incidents';
import { assembleOpsNodes, assembleOpsPeople, type OpsNodeView, type OpsPersonView } from './lib/ops-views';
import {
  AGENT_SNAPSHOT_STALE_SECONDS,
  innerTruth,
  QUALITY_SNAPSHOT_STALE_SECONDS,
  resourceTruth,
  type OpsSourceTruth,
} from './lib/source-truth';

export type OpsWorld = {
  dashboard: Live<DashboardDto>;
  live: Live<Awaited<ReturnType<typeof operationsApi.live>>>;
  profiles: Live<Awaited<ReturnType<typeof operationsApi.nodeProfiles>>>;
  activity: Live<Awaited<ReturnType<typeof operationsApi.activity>>>;
  catalog: Live<Awaited<ReturnType<typeof operationsApi.exitCatalog>>>;
  fleet: Live<Awaited<ReturnType<typeof operationsApi.fleetNodes>>>;
  users: Live<Awaited<ReturnType<typeof operationsApi.users>>>;
  audit: Live<Awaited<ReturnType<typeof operationsApi.audit>>>;
  metrics: KeyedLive<MetricsDto, TrafficRange>;
  nodes: OpsNodeView[];
  people: OpsPersonView[];
  incidents: OpsIncident[];
  accidents: OpsIncident[];
  chores: OpsIncident[];
  catalogRevision: number | null;
  nowSec: number;
  sources: {
    quality: OpsSourceTruth;
    agents: OpsSourceTruth;
    profiles: OpsSourceTruth;
    activity: OpsSourceTruth;
    users: OpsSourceTruth;
    catalog: OpsSourceTruth;
    metrics: OpsSourceTruth;
  };
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
  const metrics = useKeyedResource(range, (next) => operationsApi.metrics(next), wantMetrics ? minute : 0, wantMetrics);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const tick = () => setNowSec(Math.floor(Date.now() / 1000));
    tick();
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => { if (!document.hidden) tick(); }, 15_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);

  const world = useMemo(() => {
    const liveReady = live.state === 'ready';
    const qualityPresent = Boolean(liveReady && live.data.quality);
    const agentsPresent = Boolean(liveReady && live.data.agents);
    const sources = {
      quality: innerTruth(live, qualityPresent, liveReady ? live.data.qualityError : null, {
        asOfSec: liveReady ? live.data.qualityReceivedAt : null,
        staleAfterSeconds: QUALITY_SNAPSHOT_STALE_SECONDS,
        nowSec,
      }),
      agents: innerTruth(live, agentsPresent, liveReady ? live.data.agentsError : null, {
        asOfSec: liveReady ? live.data.agentsReceivedAt : null,
        staleAfterSeconds: AGENT_SNAPSHOT_STALE_SECONDS,
        nowSec,
      }),
      profiles: resourceTruth(profiles),
      activity: resourceTruth(activity),
      users: resourceTruth(users),
      catalog: resourceTruth(catalog),
      metrics: resourceTruth(metrics),
    };
    const nodes = assembleOpsNodes({
      catalogYaml: catalog.state === 'ready' ? catalog.data.yaml : null,
      catalogSource: catalog.state === 'ready' ? 'ready' : catalog.state === 'error' ? 'unavailable' : 'loading',
      qualityNodes: liveReady ? live.data.quality?.nodes : null,
      qualitySource: sources.quality.status === 'unavailable' ? 'unavailable' : sources.quality.status === 'loading' ? 'loading' : 'ready',
      agents: liveReady ? live.data.agents : null,
      agentSource: sources.agents.status === 'unavailable' ? 'unavailable' : sources.agents.status === 'loading' ? 'loading' : 'ready',
      profiles: profiles.state === 'ready' ? profiles.data : null,
      profileSource: profiles.state === 'ready' ? 'ready' : profiles.state === 'error' ? 'unavailable' : 'loading',
      activity: activity.state === 'ready' ? activity.data.users : null,
      activitySource: activity.state === 'ready' ? 'ready' : activity.state === 'error' ? 'unavailable' : 'loading',
      nowMs: nowSec * 1000,
    });
    const people = assembleOpsPeople({
      users: users.state === 'ready' ? users.data : null,
      usersSource: users.state === 'ready' ? 'ready' : users.state === 'error' ? 'unavailable' : 'loading',
      activity: activity.state === 'ready' ? activity.data.users : null,
      telemetrySource: activity.state === 'ready' ? 'ready' : activity.state === 'error' ? 'unavailable' : 'loading',
      catalogRevision: catalog.state === 'ready' ? catalog.data.revision : null,
      nowSec,
    });
    const catalogRevision = catalog.state === 'ready' ? catalog.data.revision : null;
    const qualityUpdatedAtSec = liveReady ? live.data.quality?.updatedAt ?? null : null;
    const incidents = incidentsFromWorld({ nodes, people, catalogRevision, nowSec, qualityUpdatedAtSec });
    return {
      nodes,
      people,
      incidents,
      accidents: accidentsOnly(incidents),
      chores: choresOnly(incidents),
      catalogRevision,
      nowSec,
      sources,
    };
  }, [
    nowSec,
    live.state, live.refreshedAt, live.stale,
    profiles.state, profiles.refreshedAt, profiles.stale,
    activity.state, activity.refreshedAt, activity.stale,
    catalog.state, catalog.refreshedAt, catalog.stale,
    users.state, users.refreshedAt, users.stale,
    metrics.state, metrics.refreshedAt, metrics.stale, metrics.snapshotKey,
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
