import { useCallback, useMemo, useState } from 'react';
import { Action } from '@/components/ops/Action';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { EmptyLine } from '@/components/ops/Empty';
import { measured } from '@/components/ops/measured';
import { MetricCard } from '@/components/ops/MetricCard';
import { Section } from '@/components/ops/Section';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { ledgerApi, type LedgerEntryDto, type MonthSummaryDto } from '@/lib/api-ledger';
import { nowSec } from '@/lib/clock';
import { formatWhen } from '@/lib/display';
import {
  categoryTotals,
  formatCny,
  monthChoices,
  monthOf,
  monthWords,
  pendingCustomers,
  pendingNodes,
} from '@/lib/ledger';
import { useResource } from '@/lib/use-resource';
import { LedgerDrawer } from './LedgerDrawer';
import { LedgerTable } from './LedgerTable';
import { Toolbar } from './form';
import { useWrite } from './use-write';

const words = copy.ledger;

/**
 * One month of money, on one page.
 *
 * The three totals at the top are the month; everything under them exists to
 * answer "and where did that come from". The one number this page refuses to
 * print is a margin for a customer or a machine whose cost is not settled yet
 * — those rows say so in words, are listed by name, and are linked, because
 * the useful form of "we cannot tell you the margin" is "go and reconcile
 * these two".
 *
 * Locking is the page's only irreversible act, so the dialog in front of it
 * repeats the three totals and the count of what is still unreconciled: the
 * operator is agreeing to a specific set of numbers, and a dialog that only
 * says "are you sure" is asking them to agree to something they cannot see.
 */
export function Ledger() {
  const [month, setMonth] = useState(() => monthOf(nowSec()));
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState(false);

  const summary = useResource(`ledger-month-${month}`, (signal) => ledgerApi.month(month, signal));
  const entries = useResource(`ledger-entries-${month}`, (signal) => ledgerApi.entries(month, signal));
  const reload = useCallback(() => {
    summary.reload();
    entries.reload();
  }, [summary, entries]);
  const write = useWrite(reload);

  const month0 = summary.status === 'ready' ? summary.data : null;
  const rows = entries.status === 'ready' ? entries.data.items : [];
  const locked = month0?.closedAt !== null && month0?.closedAt !== undefined;

  const emails = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of month0?.customers ?? []) map.set(row.userId, row.email);
    return map;
  }, [month0]);
  const nameOf = useCallback((row: LedgerEntryDto): string => {
    if (row.subjectType === 'fleet' || row.subjectId === null) return words.subjectFleet;
    return emails.get(row.subjectId) ?? row.subjectId;
  }, [emails]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Toolbar
          aside={(
            <>
              <Action
                primary
                reason={locked ? words.closedAlready : null}
                onClick={() => setAdding(true)}
              >
                {words.newEntry}
              </Action>
              <a
                className="ops-action"
                href={ledgerApi.exportHref(month)}
                target="_blank"
                rel="noreferrer"
              >
                {words.exportAction}
              </a>
              <Action
                reason={locked ? words.closedAlready : null}
                onClick={() => setClosing(true)}
              >
                {words.closeAction}
              </Action>
            </>
          )}
        >
          <MonthPicker month={month} onChange={setMonth} />
          {month0 === null ? null : <span>{words.entryCount(rows.length)}</span>}
          {month0?.closedAt ? (
            <span className="ops-tag">
              {words.closedBy(month0.closedBy ?? copy.missing, formatWhen(month0.closedAt))}
            </span>
          ) : null}
        </Toolbar>

        {write.error ? (
          <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{write.error}</p>
        ) : null}

        {month0 === null ? (
          <EmptyLine message={summary.status === 'error' ? summary.message : copy.loading} />
        ) : (
          <Totals summary={month0} />
        )}
      </div>

      {month0 === null ? null : (
        <>
          <Section title={words.byCategory}>
            <Categories summary={month0} />
          </Section>
          <Section title={words.pending}>
            <Pending summary={month0} />
          </Section>
        </>
      )}

      <Section
        title={words.entries}
        aside={locked ? (
          <span className="min-w-0 truncate text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
            {words.lockedNote}
          </span>
        ) : null}
      >
        <LedgerTable
          rows={rows}
          state={entries.status === 'loading'
            ? 'loading'
            : entries.status === 'error'
              ? 'error'
              : rows.length === 0 ? 'empty' : 'ready'}
          message={entries.status === 'error' ? entries.message : undefined}
          locked={locked}
          currentMonth={monthOf(nowSec())}
          nameOf={nameOf}
          onChanged={reload}
        />
      </Section>

      <LedgerDrawer
        open={adding}
        month={month}
        onClose={() => setAdding(false)}
        onSaved={reload}
      />

      <ConfirmDialog
        open={closing}
        title={words.closeTitle}
        consequence={month0 === null ? '' : words.closeBody(
          monthWords(month0.month),
          formatCny(month0.revenueCnyMinor) ?? copy.missing,
          formatCny(month0.costCnyMinor) ?? copy.missing,
          formatCny(month0.marginCnyMinor) ?? copy.missing,
          month0.unreconciled === 0 ? words.pendingNone : words.pendingCount(month0.unreconciled),
        )}
        confirm={words.closeConfirm}
        pending={write.pending}
        failure={write.error}
        onCancel={() => setClosing(false)}
        onConfirm={() => {
          void write.run(() => ledgerApi.close(month)).then((ok) => {
            if (ok) setClosing(false);
          });
        }}
      />
    </div>
  );
}

/** Which month is on screen. A year of them: nothing older is still being written. */
function MonthPicker({ month, onChange }: { month: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center gap-1.5">
      <span>{words.monthField}</span>
      <select
        className="h-7 rounded-[8px] border border-[var(--hairline)] bg-[var(--background)] px-2 font-mono text-body outline-none focus:border-[var(--accent)]"
        value={month}
        onChange={(event) => onChange(event.target.value)}
      >
        {monthChoices(nowSec()).map((option) => (
          <option key={option} value={option}>{monthWords(option)}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * The month in three numbers, all measured off the same read.
 *
 * They share `updatedAt` because they are one answer to one question — a
 * revenue stamped a minute fresher than the cost it is netted against would
 * invite the reading that the margin is newer than either.
 */
function Totals({ summary }: { summary: MonthSummaryDto }) {
  const at = summary.updatedAt;
  const cell = (value: number) => measured<number | null>(value, at, words.source);
  const money = (value: number) => ({ number: formatCny(value) ?? copy.missing });
  return (
    <div className="grid gap-6 border-y border-[var(--hairline)] py-4 sm:grid-cols-3">
      <MetricCard label={words.revenue} value={cell(summary.revenueCnyMinor)} format={money} />
      <MetricCard label={words.cost} value={cell(summary.costCnyMinor)} format={money} />
      <MetricCard label={words.margin} value={cell(summary.marginCnyMinor)} format={money} />
    </div>
  );
}

/** Where the month went, biggest first. A category with nothing in it is not a row. */
function Categories({ summary }: { summary: MonthSummaryDto }) {
  const rows = categoryTotals(summary);
  if (rows.length === 0) return <EmptyLine message={words.noCategories} />;
  return (
    <ul className="flex max-w-[420px] flex-col">
      {rows.map((row) => (
        <li
          key={row.category}
          className="flex items-baseline justify-between gap-4 border-b border-[var(--hairline)] py-2 last:border-b-0"
        >
          <span className="text-body">{words.category[row.category]}</span>
          <Value value={formatCny(row.cnyMinor)} source={words.source} mono />
        </li>
      ))}
    </ul>
  );
}

/**
 * Who cannot be costed yet, by name and by link.
 *
 * The margin for these rows is the word for unreconciled and never a figure:
 * the cost of a customer sitting on an unreconciled machine is a guess, and a
 * guessed margin is exactly the number that would be believed and acted on.
 */
function Pending({ summary }: { summary: MonthSummaryDto }) {
  const customers = pendingCustomers(summary);
  const nodes = pendingNodes(summary);
  if (customers.length === 0 && nodes.length === 0) {
    return <EmptyLine message={words.pendingNone} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-[var(--muted-foreground)]">{words.pendingLead}</p>
      <span className="ops-tag tone-rem self-start">{words.pendingCount(summary.unreconciled)}</span>
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <PendingList
          title={words.pendingCustomers}
          rows={customers.map((row) => ({
            key: row.userId,
            label: row.email,
            href: `#/customers/${encodeURIComponent(row.userId)}`,
          }))}
        />
        <PendingList
          title={words.pendingNodes}
          rows={nodes.map((row) => ({
            key: row.name,
            label: row.name,
            href: `#/nodes/${encodeURIComponent(row.name)}`,
          }))}
        />
      </div>
    </div>
  );
}

function PendingList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; label: string; href: string }>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-micro text-[var(--muted-foreground)]">{title}</span>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-baseline justify-between gap-4 border-b border-[var(--hairline)] py-2 last:border-b-0"
          >
            <a
              className="min-w-0 truncate text-body underline decoration-[var(--hairline)] underline-offset-4 hover:decoration-[var(--accent)]"
              href={row.href}
            >
              {row.label}
            </a>
            <span className="shrink-0 text-micro text-[var(--muted-foreground)]">{words.pending}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
