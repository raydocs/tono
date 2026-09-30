import { cloneElement, isValidElement, useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * Label on top, hint under the label, error replaces the hint. The field
 * wires `id`, `aria-invalid` and `aria-describedby` into its one child, so
 * screen readers read the hint and the error with the input.
 */
export function Field({ label, hint, error, required, children, className }: {
  label: string; hint?: React.ReactNode; error?: string | null; required?: boolean; children: React.ReactElement; className?: string;
}) {
  const id = useId();
  const note = `${id}-note`;
  const child = isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': hint || error ? note : undefined, 'aria-required': required || undefined })
    : children;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}{required && <span className="ml-0.5 text-sev" aria-hidden>*</span>}
      </label>
      {child}
      {(error || hint) && <p id={note} className={cn('text-xs', error ? 'text-sev' : 'text-muted')}>{error ?? hint}</p>}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('field-input', props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={4} {...props} className={cn('field-input', props.className)} />;
}

export function Select({ options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select {...props} className={cn('field-input appearance-none bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8', props.className)}
      style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 12 12%27%3E%3Cpath d=%27M3 4.5l3 3 3-3%27 fill=%27none%27 stroke=%27%23888%27 stroke-width=%271.5%27/%3E%3C/svg%3E")' }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button id={id} type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors', checked ? 'border-accent bg-accent' : 'border-line-strong bg-hover')}>
      <span className={cn('inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-[2px]')} />
    </button>
  );
}

export function Checkbox({ checked, onChange, label, indeterminate }: { checked: boolean; onChange: (v: boolean) => void; label: string; indeterminate?: boolean }) {
  return (
    <input type="checkbox" aria-label={label} checked={checked} ref={(el) => { if (el) el.indeterminate = !!indeterminate; }}
      onChange={(e) => onChange(e.target.checked)} onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 cursor-pointer rounded border-line-strong accent-[var(--accent)]" />
  );
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
