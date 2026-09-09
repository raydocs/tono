import type { ReactNode } from 'react';
import { Action, ActionRow } from '@/components/ops/Action';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { copy } from '@/copy/copy';
import { cn } from '@/lib/utils';

/**
 * The controls the settings drawers are built from.
 *
 * They are here rather than in `src/components/ops` because they are form
 * furniture, not a way of showing a measurement: nothing on this page is
 * measured, so nothing here goes through `Value`. Settings is the one surface
 * in the console that is typed into rather than read, and it keeps its own
 * small vocabulary of a label, a box and a line of help.
 */

const CONTROL = 'h-8 w-full min-w-0 rounded-[8px] border border-[var(--hairline)] bg-[var(--background)] px-2.5 text-body outline-none focus:border-[var(--accent)] placeholder:text-[var(--muted-foreground)]';

/** A label, a control, and — when the field has a trap in it — one line of help. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-micro text-[var(--muted-foreground)]">{label}</span>
      {children}
      {hint ? (
        <span className="text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  mono,
  type,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  type?: 'text' | 'date' | 'url';
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type={type ?? 'text'}
        className={cn(CONTROL, mono && 'font-mono')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  hint,
  value,
  options,
  word,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: readonly T[];
  word: (option: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <select
        className={CONTROL}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option} value={option}>{word(option)}</option>
        ))}
      </select>
    </Field>
  );
}

/** A yes/no as two words rather than a tick: both states read at a glance. */
export function BoolField({
  label,
  hint,
  value,
  trueWord,
  falseWord,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  trueWord: string;
  falseWord: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <select
        className={CONTROL}
        value={value ? 'on' : 'off'}
        onChange={(event) => onChange(event.target.value === 'on')}
      >
        <option value="on">{trueWord}</option>
        <option value="off">{falseWord}</option>
      </select>
    </Field>
  );
}

/**
 * The rule above a table, when the block has no heading of its own.
 *
 * Most sections are one table under the page heading, and repeating that
 * heading over the table said the same word twice in eight vertical pixels.
 * What belongs there instead is the count and the one thing you can press.
 */
export function Toolbar({ children, aside }: { children?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--hairline)] pb-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-micro text-[var(--muted-foreground)]">
        {children}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">{aside}</div>
    </div>
  );
}

/** Two columns on anything wider than a phone; the drawer is 420 px, so one. */
export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3">{children}</div>;
}

/**
 * Save, cancel, and — on an existing record — delete, kept apart from the
 * other two so the destructive one is never where the confirming thumb lands.
 */
export function FormFooter({
  pending,
  error,
  onSave,
  onCancel,
  onRemove,
}: {
  pending: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--hairline)] pt-4">
      {error ? <p className="panel-error rounded-[8px] px-3 py-2 text-body">{error}</p> : null}
      <ActionRow>
        <Action primary pending={pending} onClick={onSave}>
          {pending ? copy.settings.saving : copy.settings.save}
        </Action>
        <Action onClick={onCancel}>{copy.settings.cancel}</Action>
        {onRemove ? (
          <Action className="ml-auto" pending={pending} onClick={onRemove}>
            {copy.settings.remove}
          </Action>
        ) : null}
      </ActionRow>
    </div>
  );
}

/**
 * A delete, with the consequence spelled out rather than asked about.
 *
 * "Are you sure?" tells an operator nothing they did not already know; what
 * they need before pressing the button is which thing stops happening, so
 * `body` is a sentence about the aftermath and the dialog has no other job.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirm,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirm: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="gap-4 rounded-[10px] border-[var(--hairline)] bg-[var(--surface)] p-5 sm:max-w-[420px]"
      >
        <DialogHeader className="gap-2">
          <DialogTitle className="text-row font-medium">{title}</DialogTitle>
          <DialogDescription className="text-body text-[var(--muted-foreground)]">
            {body}
          </DialogDescription>
        </DialogHeader>
        <ActionRow>
          <Action primary pending={pending} onClick={onConfirm}>{confirm}</Action>
          <Action onClick={onClose}>{copy.settings.cancel}</Action>
        </ActionRow>
      </DialogContent>
    </Dialog>
  );
}
