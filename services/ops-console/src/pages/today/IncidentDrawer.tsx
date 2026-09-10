import { useState } from 'react';
import type { CustomerSummaryDto, IncidentDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { DetailDrawer } from '@/components/ops/DetailDrawer';
import { Empty } from '@/components/ops/Empty';
import { StatusWord } from '@/components/ops/StatusWord';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import { severityTone } from '@/lib/codes';
import { formatDurationSince, formatWhen, formatWhenAgo } from '@/lib/display';
import { closeIncident, openCustomer } from '@/lib/hash-route';
import { childrenOf, evidenceSentence, incidentSubject } from '@/lib/incidents';
import { usePrivacy } from '@/lib/privacy';
import { sourceWord } from '@/lib/sources';
import { useIsPhone } from '@/lib/use-phone';
import { useResource } from '@/lib/use-resource';
import { cn } from '@/lib/utils';
import { CloseDialog } from './CloseDialog';
import { FollowupLog } from './Followups';
import { Block, NextCheck, NextSteps, Recheck, Unconfirmed } from './Handling';
import { IncidentPrimary } from './IncidentAction';

/**
 * The incident handling card, addressable as `?incident=`.
 *
 * It was a report on an incident and is now the sheet an operator works
 * through: what is known, who might be hurt and is not counted yet, what to do
 * next and in what order, how to measure it again, when to come back, and what
 * has already been done about it. The review's line was that the console could
 * record a fault and not repair one; every block below exists because one step
 * of the repair had nowhere to live.
 *
 * The write actions do not touch local state: they POST, then reload both this
 * drawer and the list behind it. An optimistic tick that turns out to be wrong
 * is worse here than a half-second wait — the operator is looking at this page
 * precisely because they no longer trust what they were told.
 */
export function IncidentDrawer({
  id,
  incidents,
  customers,
  onChanged,
}: {
  id: string | null;
  incidents: readonly IncidentDto[];
  customers: readonly CustomerSummaryDto[];
  onChanged: () => void;
}) {
  const privacy = usePrivacy();
  const phone = useIsPhone();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  /** Bumped by anything that writes a followup, so the log refetches itself. */
  const [beat, setBeat] = useState(0);
  const detail = useResource(id, (signal) => opsApi.incident(id as string, signal));

  function reload() {
    detail.reload();
    setBeat((n) => n + 1);
    onChanged();
  }

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setFailure(null);
    try {
      await action();
      reload();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setPending(false);
    }
  }

  const incident = detail.status === 'ready' ? detail.data.incident : null;
  const children = id === null ? [] : childrenOf(incidents, id);

  /**
   * The bookkeeping verbs. The repair itself leads the next-steps block
   * further up, beside the reasoning it belongs to; what is pinned to the
   * bottom edge is
   * claiming, silencing, and the one press that ends the incident — which now
   * has to say how it ended before it will run.
   *
   * On a phone the three of them are the bar the sheet exists for, so they lose
   * the heading and the rule above it: 24 px of label on the bottom edge of a
   * 390 px screen is 24 px the buttons do not get, and a bar of three verbs
   * needs no word telling the reader they are actions.
   */
  const bar = !incident ? null : (
    <>
      <ActionRow className={cn('sheet-actions', phone ? 'flex-nowrap' : 'pt-1')}>
        {incident.status === 'open' ? (
          <Action pending={pending} onClick={() => run(() => opsApi.ackIncident(incident.id))}>
            {copy.incidentPrimary.ack}
          </Action>
        ) : null}
        <Action pending={pending} onClick={() => run(() => opsApi.snoozeIncident(incident.id))}>
          {copy.incidentPrimary.snooze}
        </Action>
        <Action primary pending={pending} onClick={() => setClosing(true)}>
          {copy.incidentPrimary.resolve}
        </Action>
      </ActionRow>
      {failure ? <p className="panel-error mt-2 rounded-[10px] px-3 py-2 text-body">{failure}</p> : null}
    </>
  );
  const actions = bar === null ? null : phone ? bar : (
    <Block title={copy.incidentDrawer.actions}>{bar}</Block>
  );

  return (
    <DetailDrawer
      open={id !== null}
      title={incident?.title ?? copy.pages.today}
      onClose={closeIncident}
      footer={actions}
    >
      {detail.status !== 'ready' || !incident ? (
        <Empty message={detail.status === 'error' ? detail.message : copy.loading} />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('ops-tag tone-fg', `tone-${severityTone(incident.severity)}`)}>
                {copy.severity[incident.severity]}
              </span>
              <span className="ops-tag">{subject(incident, customers, privacy.email)}</span>
              <span className="text-micro text-[var(--muted-foreground)]">
                {copy.incidentOpenFor}{' '}
                <span className="font-mono normal-case tracking-normal">
                  {formatDurationSince(incident.openedAt)}
                </span>
              </span>
            </div>
            {/* The pair a verified recovery is judged on. A reading older
                than the fault proves nothing, and the operator should not
                have to work that out from two timestamps in two blocks. */}
            <p className="text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
              {copy.incidentMeasuredAgainst(
                formatWhenAgo(incident.lastSeenAt),
                formatWhenAgo(incident.openedAt),
              )}
            </p>
          </div>
          {incident.summary ? <p className="text-body">{incident.summary}</p> : null}

          {/* One measurement per line, said rather than dumped: the engine
              writes these as an object and the names in it are its own. */}
          <Block title={copy.incidentDrawer.evidence}>
            {incident.evidence.length === 0 ? (
              <Value value={null} source={sourceWord('engine')} />
            ) : incident.evidence.map((row) => (
              <p key={row.label} className="flex flex-wrap items-baseline gap-x-2 py-1">
                <span className="text-body">{evidenceSentence(row)}</span>
                <span className="text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
                  {formatWhenAgo(row.asOfSec)} · {sourceWord(row.source)}
                </span>
              </p>
            ))}
          </Block>

          <Unconfirmed incident={incident} incidents={incidents} customers={customers} />

          <Block title={copy.incidentDrawer.affected}>
            {children.length === 0 ? (
              <p className="text-micro text-[var(--muted-foreground)]">
                {copy.incidentImpact(incident.impactCount)}
              </p>
            ) : children.map((child) => {
              const person = customers.find((row) => row.userId === child.subjectId);
              return (
                <button
                  key={child.id}
                  type="button"
                  className="flex w-full items-baseline justify-between gap-3 py-1 text-left"
                  onClick={() => { if (child.subjectId) openCustomer(child.subjectId); }}
                >
                  <span className="min-w-0 truncate text-body">
                    {person ? privacy.email(person.email) : child.subjectId ?? copy.missing}
                  </span>
                  {person ? <StatusWord word={person.health} reason={person.reason} /> : null}
                </button>
              );
            })}
          </Block>

          <NextSteps
            incident={incident}
            lead={<IncidentPrimary incident={incident} onChanged={reload} />}
          />

          <Recheck incident={incident} onChanged={reload} />

          <NextCheck incident={incident} onChanged={reload} />

          <Block title={copy.incidentDrawer.log}>
            <FollowupLog incidentId={incident.id} beat={beat} />
          </Block>

          <Block title={copy.incidentDrawer.timeline}>
            {detail.data.events.items.map((row) => (
              <div key={row.id} className="flex items-baseline gap-3 py-1">
                <span className="w-24 shrink-0 font-mono text-micro text-[var(--muted-foreground)]" title={formatWhen(row.at)}>
                  {formatWhenAgo(row.at)}
                </span>
                <span className="shrink-0 text-body">{copy.incidentEvent[row.type]}</span>
                <span className="min-w-0 truncate text-body text-[var(--muted-foreground)]">
                  {row.note ?? row.actor ?? ''}
                </span>
              </div>
            ))}
          </Block>

          <Block title={copy.incidentDrawer.deliveries}>
            {detail.data.deliveries.items.length === 0 ? (
              <Value value={null} source={sourceWord('jobs')} />
            ) : detail.data.deliveries.items.map((row) => (
              <div key={row.id} className="flex items-baseline justify-between gap-3 py-1">
                <span className="min-w-0 truncate font-mono text-body normal-case">{row.target}</span>
                <span className="shrink-0 text-micro text-[var(--muted-foreground)]">
                  {copy.deliveryStatus[row.status]} · {formatWhenAgo(row.at)}
                </span>
              </div>
            ))}
          </Block>

          <CloseDialog
            incident={incident}
            open={closing}
            onClose={() => setClosing(false)}
            onChanged={reload}
          />
        </>
      )}
    </DetailDrawer>
  );
}

function subject(
  incident: IncidentDto,
  customers: readonly CustomerSummaryDto[],
  mask: (email: string) => string,
): string {
  return incidentSubject(incident, customers, mask) ?? copy.missing;
}
