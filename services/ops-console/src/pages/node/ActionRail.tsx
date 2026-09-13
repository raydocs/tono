import { useEffect, useState } from 'react';
import type { NodeAcceptanceDto, NodeDetailDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { copy } from '@/copy/copy';
import { nodeApi } from '@/lib/api-node';
import {
  actionBlockReason,
  NODE_ACTIONS,
  overrideRelistAction,
  type NodeActionSpec,
} from '@/lib/node-detail';
import { useResource, type Resource } from '@/lib/use-resource';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from './ConfirmDialog';

const TOAST_MS = 5_000;

/**
 * Everything this page can ask of the machine, in one row.
 *
 * Nothing here fires on the click: every button opens the confirmation, and
 * every confirmation says what the customer will feel. The rail also refuses
 * work it knows will not run — a hub that is not talking to this machine
 * cannot restart anything on it — and says so on the button rather than
 * queueing something that would quietly expire.
 *
 * Relisting is the one button that reads a second document: the Worker refuses
 * a relist whose sale-readiness sheet says the machine is not sellable, so the
 * button says so first, with what is missing. The override stands beside it —
 * a real second path rather than a way round the check, and the only one that
 * is audited under its own name.
 */
export function ActionRail({
  node,
  sheet,
  onChanged,
  className,
}: {
  node: NodeDetailDto;
  /** The sale-readiness sheet the page already fetched; relisting is gated on it. */
  sheet: Resource<NodeAcceptanceDto>;
  onChanged: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState<NodeActionSpec | null>(null);
  const [round, setRound] = useState(0);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  /**
   * The retirement preview is fetched per opening rather than per node: the
   * catalog it reports on can move between two visits to this dialog, and a
   * stale "nothing will break" is the one answer it must never give.
   */
  const previewKey = open?.id === 'retire' ? `${node.name}#${round}` : null;
  const preview = useResource(previewKey, (signal) => nodeApi.retirePreview(node.name, signal));

  useEffect(() => {
    if (done === null) return undefined;
    const timer = setTimeout(() => setDone(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [done]);

  function start(action: NodeActionSpec) {
    setOpen(action);
    setRound((n) => n + 1);
    setTyped('');
    setReason('');
    setFailure(null);
  }

  function close() {
    setOpen(null);
    setFailure(null);
  }

  async function confirm() {
    if (!open) return;
    setPending(true);
    setFailure(null);
    try {
      if (open.jobType === null) {
        if (preview.status !== 'ready') return;
        await nodeApi.retire(node.name, {
          expectedRevision: preview.data.expectedRevision,
          confirmation: typed.trim(),
          reason: reason.trim(),
        });
        setDone(copy.nodeActionRetired(node.name));
      } else {
        await nodeApi.enqueueJob(node.name, {
          type: open.jobType,
          confirmName: open.destructive ? node.name : undefined,
          override: open.override === true ? true : undefined,
        });
        setDone(copy.nodeActionQueued(open.label));
      }
      setOpen(null);
      onChanged();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setPending(false);
    }
  }

  const acceptance = sheet.status === 'ready' ? sheet.data : null;
  // Only offered where it can mean something: a machine that is not being sold
  // yet, is not retired, and has a sheet that came back saying no.
  const override = acceptance !== null && !acceptance.sellable
    && node.lifecycle !== 'retired' && node.catalogListed === false
    ? overrideRelistAction(acceptance)
    : null;

  return (
    <>
      <ActionRow className={cn('justify-end', className)}>
        {NODE_ACTIONS.map((action) => (
          <Action
            key={action.id}
            primary={action.id === 'pullErrors'}
            reason={actionBlockReason(action, node, acceptance)}
            onClick={() => start(action)}
          >
            {action.label}
          </Action>
        ))}
        {override ? (
          <Action key="relist-override" onClick={() => start(override)}>{override.label}</Action>
        ) : null}
      </ActionRow>

      {open ? (
        <ConfirmDialog
          action={open}
          nodeName={node.name}
          typed={typed}
          onTyped={setTyped}
          reason={reason}
          onReason={setReason}
          retire={open.jobType === null ? preview : null}
          pending={pending}
          failure={failure}
          onClose={close}
          onConfirm={confirm}
        />
      ) : null}

      {done ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[999px] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-2 text-body shadow-sm"
        >
          {done}
        </div>
      ) : null}
    </>
  );
}
