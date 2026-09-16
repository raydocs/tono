import { useState } from 'react';
import { auditSearchCopy as words } from '@/copy/audit-search';
import { usePrivacy } from '@/lib/privacy';
import { Field } from './form';

export type AuditFiltersValue = { targetId: string; actorEmail: string; before: number | null };
export const EMPTY_AUDIT_FILTERS: AuditFiltersValue = { targetId: '', actorEmail: '', before: null };
const control = 'min-h-11 w-full min-w-0 rounded-[8px] border border-[var(--hairline)] bg-[var(--background)] px-2 text-body';

export function AuditFilters({ filters, onApply }: { filters: AuditFiltersValue; onApply: (next: AuditFiltersValue) => void }) {
  const privacy = usePrivacy();
  const [targetId, setTargetId] = useState(filters.targetId);
  const [actorEmail, setActorEmail] = useState(filters.actorEmail);
  const [before, setBefore] = useState(() => {
    if (filters.before === null) return '';
    const date = new Date(filters.before * 1000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const timestamp = before === '' ? null : Math.floor(new Date(before).getTime() / 1000);
  const valid = timestamp === null || (Number.isSafeInteger(timestamp) && timestamp > 0);
  return (
    <form className="grid items-end gap-3 sm:grid-cols-2" onSubmit={(event) => {
      event.preventDefault();
      if (valid) onApply({ targetId: targetId.trim(), actorEmail: actorEmail.trim(), before: timestamp });
    }}>
      <Field label={words.target}><input className={control} value={targetId} onChange={(event) => setTargetId(event.target.value)} /></Field>
      <Field label={words.actor}><input type={privacy.privacy ? 'password' : 'text'} autoComplete="off" className={control} value={actorEmail} onChange={(event) => setActorEmail(event.target.value)} /></Field>
      <Field label={words.before}><input type="datetime-local" className={control} value={before} onChange={(event) => setBefore(event.target.value)} /></Field>
      <button type="submit" className="ops-action min-h-11" disabled={!valid} title={valid ? undefined : words.invalidTime}>{words.apply}</button>
    </form>
  );
}
