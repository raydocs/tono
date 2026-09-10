import { useState } from 'react';
import type { IncidentDto } from '@contract';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { copy } from '@/copy/copy';
import { followupApi, INCIDENT_CLOSURES, type IncidentClosure } from '@/lib/api-followups';
import { formatWhen } from '@/lib/display';
import { closureReasonNeeded, recoveryProof } from '@/lib/handling';
import { cn } from '@/lib/utils';
import { useWrite } from '../settings/use-write';

/**
 * Closing an incident, with the one question the button was missing.
 *
 * The old button wrote a recovery into the record whatever had happened: a rule
 * that fired wrongly, a fault nobody was going to chase any further and a
 * machine that genuinely came back all left the same trace. Three closures,
 * three different sentences, and only the first is allowed to claim a repair.
 *
 * A verified recovery is refused rather than hidden when the measurement does not
 * support it, and the refusal says which half is missing — the reading is
 * older than the fault, or it still reads as an alarm. Refusing in silence
 * would only teach the operator to reach for the manual close instead.
 */
export function CloseDialog({
  incident,
  open,
  onClose,
  onChanged,
}: {
  incident: IncidentDto;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const proof = recoveryProof(incident);
  const [closure, setClosure] = useState<IncidentClosure>(proof.ok ? 'verified' : 'manual');
  const [reason, setReason] = useState('');
  const write = useWrite(onChanged);

  const needsReason = closureReasonNeeded(closure);
  const ready = !needsReason || reason.trim() !== '';

  function blockedReason(id: IncidentClosure): string | null {
    return id === 'verified' ? proof.reason : null;
  }

  return (
    <ConfirmDialog
      open={open}
      title={copy.incidentCloseTitle}
      consequence={copy.incidentCloseConsequence}
      confirm={copy.incidentPrimary.resolve}
      pending={write.pending || !ready}
      failure={write.error}
      onConfirm={() => {
        void write.run(() => followupApi.resolve(
          incident.id,
          closure,
          needsReason ? reason.trim() : undefined,
        )).then((done) => {
          if (done) {
            setReason('');
            onClose();
          }
        });
      }}
      onCancel={() => { write.setError(null); onClose(); }}
    >
      <div className="flex flex-col gap-2">
        {/* The pair a verified recovery is judged on, printed rather than
            implied: the operator can see for themselves which reading is
            being trusted. */}
        <p className="text-micro text-[var(--muted-foreground)]">
          {copy.incidentMeasuredAgainst(formatWhen(proof.measuredAt), formatWhen(incident.openedAt))}
        </p>
        {INCIDENT_CLOSURES.map((id) => {
          const blocked = blockedReason(id);
          return (
            <label
              key={id}
              className={cn(
                'flex items-baseline gap-2 rounded-[10px] border border-[var(--hairline)] px-3 py-2',
                blocked && 'opacity-60',
              )}
              title={blocked ?? undefined}
            >
              <input
                type="radio"
                name="closure"
                value={id}
                checked={closure === id}
                disabled={blocked !== null}
                onChange={() => setClosure(id)}
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-body">{copy.incidentClosureChoice[id]}</span>
                <span className="text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
                  {blocked ?? copy.incidentClosureHint[id]}
                </span>
              </span>
            </label>
          );
        })}
        {needsReason ? (
          <label className="flex flex-col gap-1">
            <span className="text-micro text-[var(--muted-foreground)]">
              {copy.incidentClosureReason[closure === 'false_positive' ? 'false_positive' : 'manual']}
            </span>
            <input
              type="text"
              className="h-8 w-full min-w-0 rounded-[8px] border border-[var(--hairline)] bg-[var(--background)] px-2.5 text-body outline-none"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            {ready ? null : (
              <span className="text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
                {copy.incidentClosureNeedReason}
              </span>
            )}
          </label>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
