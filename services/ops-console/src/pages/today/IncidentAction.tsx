import { useState } from 'react';
import type { IncidentDto } from '@contract';
import { Action } from '@/components/ops/Action';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { copy } from '@/copy/copy';
import { nodeApi } from '@/lib/api-node';
import { openCustomer, openNodePage } from '@/lib/hash-route';
import { incidentAction, type IncidentActionSpec } from '@/lib/incidents';

/**
 * The button that actually moves the fault.
 *
 * Every row used to offer one button, a claim, and nothing else — which is a
 * note to yourself rather than a repair: the node was still blocked. What
 * the button does now depends on what broke, and the table of that lives in
 * `lib/incidents.ts` so both the row and the drawer lead with the same act.
 *
 * A jump needs no confirming — moving the reader costs nothing. Anything that
 * asks a machine for work goes through the same dialog the node page uses, and
 * the dialog says what the customer will feel rather than repeating the label.
 */
export function IncidentPrimary({
  incident,
  onChanged,
  primary = true,
}: {
  incident: IncidentDto;
  onChanged: () => void;
  /** The drawer already has a coloured button; only one of them is the primary. */
  primary?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const action = incidentAction(incident);
  if (!action) return null;

  function start() {
    setFailure(null);
    if (action === null || action.blocked !== null) return;
    if (action.go === 'node' && action.subjectId) {
      openNodePage(action.subjectId);
      return;
    }
    if (action.go === 'customer' && action.subjectId) {
      openCustomer(action.subjectId);
      return;
    }
    setAsking(true);
  }

  async function run(spec: IncidentActionSpec) {
    if (spec.jobType === null || spec.subjectId === null) return;
    setPending(true);
    setFailure(null);
    try {
      await nodeApi.enqueueJob(spec.subjectId, {
        type: spec.jobType,
        incidentId: incident.id,
      });
      setAsking(false);
      onChanged();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Action primary={primary} reason={action.blocked} onClick={start}>
        {action.label}
      </Action>
      {action.jobType === null ? null : (
        <ConfirmDialog
          open={asking}
          title={copy.nodeActionDialogTitle(action.label)}
          consequence={action.consequence}
          confirm={copy.nodeActionGo(action.label)}
          pending={pending}
          failure={failure}
          onConfirm={() => { void run(action); }}
          onCancel={() => { setAsking(false); setFailure(null); }}
        >
          {action.subjectId === null ? null : (
            <p className="rounded-[10px] border border-[var(--hairline)] bg-[var(--background)] px-3 py-2 font-mono text-body">
              {action.subjectId}
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
