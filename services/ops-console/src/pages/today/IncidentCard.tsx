import { useState } from 'react';
import type { IncidentDto } from '@contract';
import { Action } from '@/components/ops/Action';
import { Empty } from '@/components/ops/Empty';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import { severityTone } from '@/lib/codes';
import { formatDurationSince, formatWhen, formatWhenAgo } from '@/lib/display';
import { openIncident } from '@/lib/hash-route';
import { closureWord } from '@/lib/handling';
import { incidentAction } from '@/lib/incidents';
import { cn } from '@/lib/utils';
import { CloseDialog } from './CloseDialog';
import { IncidentPrimary } from './IncidentAction';

export function IncidentList({
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
    <div className="today-list">
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
