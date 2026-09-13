import { Action } from '@/components/ops/Action';
import { copy } from '@/copy/copy';
import { formatCount, formatWhenAgo } from '@/lib/display';
import type { NodeActionSpec } from '@/lib/node-detail';
import type { RetirePreviewDto } from '@/lib/api-node';
import type { Resource } from '@/lib/use-resource';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const INPUT = 'h-9 w-full rounded-[10px] border border-[var(--hairline)] bg-[var(--background)]'
  + ' px-3 text-body outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--accent)]';

/**
 * The step between "I meant to press that" and "I pressed that".
 *
 * It says the consequence in the customer's terms rather than repeating the
 * button's own label, prints the machine's name where the operator can compare
 * it with the one in their head, and for anything that changes the machine it
 * asks for that name to be typed back. The Worker checks the same name again
 * when the job is enqueued: this dialog is the courtesy, not the safeguard.
 */
export function ConfirmDialog({
  action,
  nodeName,
  typed,
  onTyped,
  reason,
  onReason,
  retire,
  pending,
  failure,
  onClose,
  onConfirm,
}: {
  action: NodeActionSpec;
  nodeName: string;
  typed: string;
  onTyped: (value: string) => void;
  reason: string;
  onReason: (value: string) => void;
  /** Only retirement has a preview to read before it is confirmed. */
  retire: Resource<RetirePreviewDto> | null;
  pending: boolean;
  failure: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const nameMatches = typed.trim() === nodeName;
  const previewReady = retire === null || retire.status === 'ready';
  const canRetire = retire === null || (retire.status === 'ready' && retire.data.canRetire);
  const reasonGiven = retire === null || reason.trim() !== '';
  const ready = (!action.destructive || nameMatches) && previewReady && canRetire && reasonGiven;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="gap-5 border-[var(--hairline)] bg-[var(--surface)]">
        <DialogHeader>
          <DialogTitle className="text-section font-medium">
            {copy.nodeActionDialogTitle(action.label)}
          </DialogTitle>
          <DialogDescription className="text-body text-[var(--muted-foreground)]">
            {action.consequence}
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-[10px] border border-[var(--hairline)] bg-[var(--background)] px-3 py-2 font-mono text-body">
          {nodeName}
        </p>

        {retire === null ? null : <RetirePreview retire={retire} />}

        {retire === null ? null : (
          <label className="flex flex-col gap-1.5">
            <span className="text-micro text-[var(--muted-foreground)]">{copy.nodeRetireReason}</span>
            <input
              className={INPUT}
              placeholder={copy.nodeRetireReasonPrompt}
              value={reason}
              onChange={(event) => onReason(event.target.value)}
            />
          </label>
        )}

        {action.destructive ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-micro text-[var(--muted-foreground)]">{copy.nodeActionTypeName}</span>
            <input
              className={INPUT}
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(event) => onTyped(event.target.value)}
            />
            {typed.trim() !== '' && !nameMatches ? (
              <span className="text-micro text-[var(--muted-foreground)]">
                {copy.nodeActionNameMismatch}
              </span>
            ) : null}
          </label>
        ) : null}

        {failure ? <p className="panel-error rounded-[10px] px-3 py-2 text-body">{failure}</p> : null}

        <DialogFooter className="gap-2">
          <Action onClick={onClose}>{copy.nodeActionBack}</Action>
          <Action primary pending={pending || !ready} onClick={onConfirm}>
            {copy.nodeActionGo(action.label)}
          </Action>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Retirement is the one action whose cost is known before it is paid, so the
 * console asks the Worker first and shows what came back: who is on the
 * machine right now, and anything the catalog will not let happen.
 */
function RetirePreview({ retire }: { retire: Resource<RetirePreviewDto> }) {
  if (retire.status === 'loading') {
    return <p className="text-body text-[var(--muted-foreground)]">{copy.nodeRetireLoading}</p>;
  }
  if (retire.status === 'error') {
    return <p className="panel-error rounded-[10px] px-3 py-2 text-body">{retire.message}</p>;
  }
  const affected = retire.data.affectedUsers;
  const newest = affected.reduce<number | null>(
    (latest, row) => (latest === null || row.lastSeenAt > latest ? row.lastSeenAt : latest),
    null,
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body">
        {affected.length === 0
          ? copy.nodeRetireNoneAffected
          : copy.nodeRetireAffected(formatCount(affected.length))}
        {newest === null ? null : (
          <span className="ml-2 text-micro text-[var(--muted-foreground)]">
            {copy.nodeOccupantColumns.lastSeen} {formatWhenAgo(newest)}
          </span>
        )}
      </p>
      {retire.data.warnings.map((warning) => (
        <p key={warning} className="text-body text-[var(--muted-foreground)]">{warning}</p>
      ))}
      {retire.data.canRetire ? null : (
        <p className="panel-error rounded-[10px] px-3 py-2 text-body">{copy.nodeRetireUnsafe}</p>
      )}
    </div>
  );
}
