import type { ReactNode } from 'react';
import { copy } from '@/copy/copy';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Action, ActionRow } from './Action';

/**
 * The gate in front of anything that changes what customers get.
 *
 * The description is the consequence in a sentence, not a question. "Are you
 * sure" tells an operator nothing they did not already know; "withdrawing
 * stops the auto-update offering 0.0.72, and does nothing to the clients that
 * already have it" answers the two things they are actually weighing — what
 * stops, and what does not. The confirming button repeats the verb rather
 * than saying OK, so the last thing read before the click is what the click
 * does.
 */
export function ConfirmDialog({
  open,
  title,
  consequence,
  confirm,
  pending,
  failure,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  consequence: string;
  confirm: string;
  pending?: boolean;
  failure?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** An extra field the consequence depends on, e.g. the version to set. */
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="border-[var(--hairline)] bg-[var(--surface)] sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-row font-medium">{title}</DialogTitle>
          <DialogDescription className="text-body text-[var(--muted-foreground)]">
            {consequence}
          </DialogDescription>
        </DialogHeader>
        {children}
        {failure ? <p className="panel-error rounded-[10px] px-3 py-2 text-body">{failure}</p> : null}
        <DialogFooter>
          <ActionRow>
            <Action onClick={onCancel}>{copy.releaseConfirm.cancel}</Action>
            <Action primary pending={pending} onClick={onConfirm}>{confirm}</Action>
          </ActionRow>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
