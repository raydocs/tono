import { useState, type ReactNode } from 'react';
import type { CustomerSummaryDto, IncidentDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { copy } from '@/copy/copy';
import { followupApi, handlingOf } from '@/lib/api-followups';
import { nodeApi } from '@/lib/api-node';
import { formatWhen, formatWhenAgo } from '@/lib/display';
import { checkPresets, nextSteps, recheckSpec, unconfirmedImpact } from '@/lib/handling';
import { openCustomer } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { WriteError } from '../customer/ask';
import { useWrite } from '../settings/use-write';

/** One block of the card: a hairline, a heading, and whatever it is about. */
export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="mb-1 border-b border-[var(--hairline)] pb-1 text-micro text-[var(--muted-foreground)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Impact nobody has confirmed.
 *
 * The engine counts the customers it has measured failing. The people parked
 * on the same machine whose clients have said nothing since before the fault
 * have been measured neither way — and the console used to leave them out of
 * the story entirely, which is how "five customers affected" reads as "the
 * other fifteen are fine".
 */
export function Unconfirmed({
  incident,
  incidents,
  customers,
}: {
  incident: IncidentDto;
  incidents: readonly IncidentDto[];
  customers: readonly CustomerSummaryDto[];
}) {
  const privacy = usePrivacy();
  const split = unconfirmedImpact(incident, incidents, customers);
  return (
    <Block title={copy.incidentDrawer.unconfirmed}>
      <p className="py-1 text-body">{copy.incidentImpactSplit(split.sure, split.maybe.length)}</p>
      <p className="text-micro text-[var(--muted-foreground)]">{split.why}</p>
      {split.maybe.map((row) => (
        <button
          key={row.userId}
          type="button"
          className="flex w-full items-baseline justify-between gap-3 py-1 text-left"
          onClick={() => openCustomer(row.userId)}
        >
          <span className="min-w-0 truncate text-body">{privacy.email(row.email)}</span>
          <span className="shrink-0 text-micro text-[var(--muted-foreground)]">
            {formatWhenAgo(row.connected.asOfSec)}
          </span>
        </button>
      ))}
    </Block>
  );
}

/**
 * Next steps: the button that moves the fault, and — where the review wrote a
 * sequence — the order to do it in.
 *
 * The primary action itself is rendered by the caller, because the drawer and
 * the row have to lead with the same act. What this adds is the reasoning the
 * review asked for on a degraded machine, where pressing the obvious button
 * first is how a whole machine is taken out over one carrier's loss figure.
 */
export function NextSteps({ incident, lead }: { incident: IncidentDto; lead: ReactNode }) {
  const steps = nextSteps(incident);
  return (
    <Block title={copy.incidentDrawer.nextSteps}>
      <div className="py-1"><ActionRow>{lead}</ActionRow></div>
      {steps.length === 0 ? (
        <p className="text-micro text-[var(--muted-foreground)]">{copy.incidentNoSteps}</p>
      ) : (
        <ol className="flex flex-col gap-1 pt-1">
          {steps.map((step) => (
            <li key={step} className="flex items-baseline gap-2">
              <span aria-hidden className="text-micro text-[var(--muted-foreground)]">·</span>
              <span className="text-body">{step}</span>
            </li>
          ))}
        </ol>
      )}
    </Block>
  );
}

/**
 * Re-measuring: measure the thing again, and write down that you did.
 *
 * The two halves are one act. An operator who probes a machine and does not
 * record it has left the next person — themselves, in four hours — with no way
 * to tell a fault that was re-checked from one nobody has touched, so the
 * followup is posted by the same handler and not by remembering to.
 */
export function Recheck({
  incident,
  onChanged,
}: {
  incident: IncidentDto;
  onChanged: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const write = useWrite(onChanged);
  const spec = recheckSpec(incident);

  return (
    <Block title={copy.incidentDrawer.recheck}>
      <div className="py-1">
        <Action
          reason={spec === null ? copy.incidentRecheckBlocked : null}
          onClick={() => setAsking(true)}
        >
          {copy.incidentRecheckGo}
        </Action>
      </div>
      <WriteError message={write.error} />
      {spec === null ? null : (
        <ConfirmDialog
          open={asking}
          title={copy.nodeActionDialogTitle(copy.incidentRecheckGo)}
          consequence={spec.consequence}
          confirm={copy.nodeActionGo(copy.incidentRecheckGo)}
          pending={write.pending}
          failure={write.error}
          onConfirm={() => {
            void write.run(async () => {
              await nodeApi.enqueueJob(spec.node, { type: spec.jobType, incidentId: incident.id });
              await followupApi.addForIncident(incident.id, {
                kind: 'note',
                body: copy.incidentRecheckNote,
              });
            }).then((done) => { if (done) setAsking(false); });
          }}
          onCancel={() => { setAsking(false); write.setError(null); }}
        />
      )}
    </Block>
  );
}

/**
 * The next check: when to come back, as three presses rather than a date field.
 *
 * Fifteen minutes is "I am watching this", an hour is "it is queued behind
 * something", tomorrow morning is "this is not worth the night". Everything an
 * operator actually chooses between at three in the morning.
 */
export function NextCheck({
  incident,
  onChanged,
}: {
  incident: IncidentDto;
  onChanged: () => void;
}) {
  const write = useWrite(onChanged);
  const { nextCheckAt } = handlingOf(incident);
  return (
    <Block title={copy.incidentDrawer.nextCheck}>
      {/* An absolute stamp, not "in 15 minutes": relative time counts
          backwards on these pages, and a future moment said that way reads
          as having already happened. */}
      <p className="py-1 text-body">
        {nextCheckAt === null
          ? copy.incidentNextCheckNone
          : copy.incidentNextCheckAt(formatWhen(nextCheckAt))}
      </p>
      <ActionRow className="pt-1">
        {checkPresets().map((preset) => (
          <Action
            key={preset.id}
            pending={write.pending}
            onClick={() => { void write.run(() => followupApi.setNextCheck(incident.id, preset.at)); }}
          >
            {copy.incidentNextCheckPreset[preset.id]}
          </Action>
        ))}
      </ActionRow>
      <WriteError message={write.error} />
    </Block>
  );
}
