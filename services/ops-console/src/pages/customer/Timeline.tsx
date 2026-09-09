import { useMemo, useState } from 'react';
import type { ConnectionEventDto, CustomerDeviceDto } from '@contract';
import { Chip } from '@/components/ops/Chip';
import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { nowMs } from '@/lib/clock';
import { eventTone, eventWord, explainCode, isFailure, isSuccess, isSwitch, stageWord } from '@/lib/codes';
import { formatClock, formatDate, formatLatency } from '@/lib/display';
import { cn } from '@/lib/utils';

/** time · outcome · node · stage · code+explanation · elapsed · client · carrier */
const GRID = 'grid grid-cols-[68px_64px_140px_52px_minmax(160px,1fr)_60px_116px_104px] gap-x-3 items-baseline';
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

type Day = { key: number; label: string; rows: ConnectionEventDto[] };

export function Timeline({
  events,
  devices,
  state,
  message,
}: {
  events: readonly ConnectionEventDto[];
  devices: readonly CustomerDeviceDto[];
  state: 'loading' | 'error' | 'ready';
  message?: string;
}) {
  const [failedOnly, setFailedOnly] = useState(false);
  const [week, setWeek] = useState(true);
  const [device, setDevice] = useState<string>('');

  const rows = useMemo(() => {
    const since = nowMs() - WEEK_MS;
    return events.filter((row) => (
      (!failedOnly || isFailure(row.kind))
      && (!week || row.atMs >= since)
      && (device === '' || row.deviceId === device)
    ));
  }, [events, failedOnly, week, device]);

  const days = useMemo(() => toDays(rows), [rows]);

  return (
    <Section
      title={copy.customerSections.timeline}
      aside={
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            active={!failedOnly && !week && device === ''}
            onClick={() => { setFailedOnly(false); setWeek(false); setDevice(''); }}
          >
            {copy.timelineFilters.all}
          </Chip>
          <Chip active={failedOnly} onClick={() => setFailedOnly((v) => !v)}>
            {copy.timelineFilters.failed}
          </Chip>
          <Chip active={week} onClick={() => setWeek((v) => !v)}>
            {copy.timelineFilters.week}
          </Chip>
          <select
            aria-label={copy.timelineFilters.device}
            className="ops-chip"
            value={device}
            onChange={(event) => setDevice(event.target.value)}
          >
            <option value="">{copy.timelineFilters.device}</option>
            {devices.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </div>
      }
    >
      {state === 'loading' ? <Empty message={copy.loading} />
        : state === 'error' ? <Empty message={message || copy.loadError} />
          : days.length === 0 ? <Empty message={copy.emptyTimeline} />
            : (
              <div className="overflow-x-auto">
                <div className="min-w-[860px]">
                  <div className={cn(GRID, 'pb-1 text-micro text-[var(--muted-foreground)]')}>
                    <span>{copy.timelineColumns.at}</span>
                    <span>{copy.timelineColumns.outcome}</span>
                    <span>{copy.timelineColumns.node}</span>
                    <span>{copy.timelineColumns.stage}</span>
                    <span>{copy.timelineColumns.code}</span>
                    <span className="text-right">{copy.timelineColumns.elapsed}</span>
                    <span>{copy.timelineColumns.client}</span>
                    <span>{copy.timelineColumns.carrier}</span>
                  </div>
                  {days.map((day) => (
                    <div key={day.key}>
                      <div className="day-head">
                        <span className="font-mono text-row">{day.label}</span>
                        <span className="text-micro text-[var(--muted-foreground)]">{summaryOf(day.rows)}</span>
                      </div>
                      {day.rows.map((row) => <Row key={row.id} row={row} />)}
                    </div>
                  ))}
                </div>
              </div>
            )}
    </Section>
  );
}

function Row({ row }: { row: ConnectionEventDto }) {
  const explanation = explainCode(row.code);
  const client = [row.appVersion, row.osVersion].filter(Boolean).join(' · ');
  return (
    <div className={cn(GRID, 'data-row border-b border-[var(--hairline)] py-1 last:border-b-0')}>
      <span className="font-mono text-body text-[var(--muted-foreground)]">
        {formatClock(Math.floor(row.atMs / 1_000))}
      </span>
      <span className={cn('tone-fg text-body', `tone-${eventTone(row.kind)}`)}>{eventWord(row.kind)}</span>
      <span className="truncate text-body" title={row.node ?? undefined}>
        {row.node ?? copy.missing}
      </span>
      <span className="text-body text-[var(--muted-foreground)]">
        {stageWord(row.stage) ?? copy.missing}
      </span>
      <span className="min-w-0 truncate text-body" title={row.error ?? undefined}>
        {row.code ? (
          <>
            <span className="font-mono">{row.code}</span>
            <span className="text-[var(--muted-foreground)]"> {explanation}</span>
          </>
        ) : copy.missing}
      </span>
      <span className="text-right font-mono text-body">
        {row.elapsedMs === null ? copy.missing : formatLatency(row.elapsedMs)}
      </span>
      <span className="truncate text-body text-[var(--muted-foreground)]" title={client || undefined}>
        {client || copy.missing}
      </span>
      <Carrier row={row} />
    </div>
  );
}

/**
 * The carrier on the row is the customer's, or it is nothing.
 *
 * When the upload travelled through the tunnel the edge ASN describes the
 * exit, not the person, so printing it here would put a Tokyo carrier on a
 * Jiangsu customer's failure — the exact confusion the contract warns about.
 */
function Carrier({ row }: { row: ConnectionEventDto }) {
  if (row.edgeViaExit) {
    return (
      <span title={copy.carrierViaExit}>
        <Value value={null} source={copy.sourceWord.collector} />
      </span>
    );
  }
  const text = [row.edgeAsOrg, row.edgeRegion].filter(Boolean).join(' · ');
  return (
    <span className="truncate text-body text-[var(--muted-foreground)]" title={text || undefined}>
      {text || copy.missing}
    </span>
  );
}

function summaryOf(rows: readonly ConnectionEventDto[]): string {
  let ok = 0;
  let fail = 0;
  let switched = 0;
  for (const row of rows) {
    if (isSuccess(row.kind)) ok += 1;
    else if (isFailure(row.kind)) fail += 1;
    else if (isSwitch(row.kind)) switched += 1;
  }
  return copy.daySummary(ok, fail, switched);
}

/** Newest day first, and newest row first inside it — the way an operator reads. */
function toDays(rows: readonly ConnectionEventDto[]): Day[] {
  const byDay = new Map<number, Day>();
  for (const row of rows) {
    const at = new Date(row.atMs);
    const key = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
    let day = byDay.get(key);
    if (!day) {
      day = { key, label: formatDate(Math.floor(key / 1_000)), rows: [] };
      byDay.set(key, day);
    }
    day.rows.push(row);
  }
  const days = [...byDay.values()].sort((a, b) => b.key - a.key);
  for (const day of days) day.rows.sort((a, b) => b.atMs - a.atMs);
  return days;
}
