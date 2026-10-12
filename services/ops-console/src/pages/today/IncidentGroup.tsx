import { useState } from 'react';
import type { IncidentDto } from '@contract';
import { Action } from '@/components/ops/Action';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import { severityTone } from '@/lib/codes';
import { formatDurationSince, formatWhen, formatWhenAgo } from '@/lib/display';
import { goPage, openIncident, openNodePage } from '@/lib/hash-route';
import { groupLabel, unclaimed, type IncidentGroup } from '@/lib/incident-groups';
import { incidentAction } from '@/lib/incidents';
import { cn } from '@/lib/utils';

/**
 * Twelve machines the wall took, as one card.
 *
 * The engine still opens twelve incidents, and each keeps its own state; the
 * card is only the page's way of saying it is one thing, with the verbs that
 * make sense on all of them at once. The members are one tap down (shut by
 * default, so a phone's first screen is the card and not its twelve lines),
 * each with the node's own page behind its name.
 *
 * The jump differs from a single card's: a group has no one node page to go
 * to, so the act that moves a node's fault leads to the fleet list, where the
 * whole set is in view.
 */
export function IncidentGroupRow({
  group,
  onChanged,
}: {
  group: IncidentGroup;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const waiting = unclaimed(group);
  const lastSeen = Math.max(...group.members.map((member) => member.lastSeenAt));
  const leads = group.members.some((member) => incidentAction(member)?.go === 'node');

  /** One write after another: a flaky hub should fail on the first, not on all twelve at once. */
  async function each(targets: readonly IncidentDto[], write: (id: string) => Promise<unknown>) {
    setPending(true);
    setFailure(null);
    try {
      for (const member of targets) await write(member.id);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setPending(false);
      onChanged();
    }
  }

  return (
    <div className="incident-row incident-group">
      <span className={cn('sev-rail', `tone-${severityTone(group.severity)}`)} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-micro text-[var(--muted-foreground)]">
            {copy.todayGroupEyebrow(copy.severity[group.severity], group.members.length)}
          </span>
        </div>
        <p className="text-row">{copy.todayGroupTitle(groupLabel(group), group.members.length)}</p>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-micro text-[var(--muted-foreground)]">
          <span>{copy.incidentImpact(group.impactCount)}</span>
          <span>
            {copy.incidentGroupEarliest} {copy.incidentOpenFor}{' '}
            <span className="font-mono normal-case tracking-normal">{formatDurationSince(group.openedAt)}</span>
          </span>
          <span title={formatWhen(lastSeen)}>
            {copy.incidentLastSeen}{' '}
            <span className="font-mono normal-case tracking-normal">{formatWhenAgo(lastSeen)}</span>
          </span>
        </div>
        {failure ? <p className="panel-error rounded-[10px] px-3 py-2 text-body">{failure}</p> : null}
        <details className="group-fold">
          <summary className="text-micro text-[var(--muted-foreground)]">
            {copy.incidentGroupMembers(group.members.length)}
          </summary>
          <ul className="group-members">
            {group.members.map((member) => (
              <li key={member.id} data-incident={member.id} className="group-member text-body">
                <button
                  type="button"
                  className="incident-title min-w-0 truncate"
                  onClick={() => { if (member.subjectId) openNodePage(member.subjectId); }}
                >
                  {member.subjectId ?? copy.missing}
                </button>
                <span className="font-mono text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
                  {formatDurationSince(member.openedAt)}
                </span>
                <span className="text-micro text-[var(--muted-foreground)]">
                  {member.status === 'open' ? copy.incidentGroupUnclaimed : copy.incidentGroupClaimed}
                </span>
                <button type="button" className="group-detail text-micro" onClick={() => openIncident(member.id)}>
                  {copy.incidentGroupDetail}
                </button>
              </li>
            ))}
          </ul>
        </details>
      </div>
      <div className="flex shrink-0 flex-wrap items-start justify-end gap-2" role="presentation">
        {leads ? (
          <Action primary onClick={() => goPage('nodes')}>
            {copy.incidentAction.retirePreview}
          </Action>
        ) : null}
        {waiting.length > 0 ? (
          <Action
            primary={!leads}
            pending={pending}
            onClick={() => { void each(waiting, (id) => opsApi.ackIncident(id)); }}
          >
            {copy.incidentGroupAckAll}
          </Action>
        ) : null}
        <Action
          pending={pending}
          onClick={() => { void each(group.members, (id) => opsApi.snoozeIncident(id)); }}
        >
          {copy.incidentGroupSnoozeAll}
        </Action>
      </div>
    </div>
  );
}
