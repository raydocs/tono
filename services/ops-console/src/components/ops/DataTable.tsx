import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { copy } from '@/copy/copy';
import { cn } from '@/lib/utils';

export type TableState = 'ready' | 'loading' | 'error' | 'empty';

export type DataColumn<T> = {
  id: string;
  header: string;
  sortValue?: (row: T) => string | number | null;
  cell: (row: T) => ReactNode;
  /** Numbers are read by their last digit: right-align them and set them in Geist Mono. */
  align?: 'left' | 'right';
  mono?: boolean;
  width?: string;
  className?: string;
};

export function DataTable<T>({
  rows,
  columns,
  getRowId,
  onRowClick,
  selectedId,
  state,
  errorMessage,
  className,
}: {
  rows: T[];
  columns: DataColumn<T>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedId?: string | null;
  state: TableState;
  errorMessage?: string;
  className?: string;
}) {
  const [sortId, setSortId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [focusId, setFocusId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    if (!sortId) return rows;
    const col = columns.find((c) => c.id === sortId);
    if (!col?.sortValue) return rows;
    const copyRows = [...rows];
    copyRows.sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), 'zh');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copyRows;
  }, [rows, columns, sortId, sortDir]);

  function toggleSort(id: string) {
    if (sortId !== id) {
      setSortId(id);
      setSortDir('asc');
      return;
    }
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
  }

  function onKey(event: KeyboardEvent<HTMLTableRowElement>, index: number, row: T) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = sorted[index + 1];
      if (next) {
        setFocusId(getRowId(next));
        event.currentTarget.nextElementSibling?.querySelector<HTMLElement>('td')?.focus();
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = sorted[index - 1];
      if (prev) {
        setFocusId(getRowId(prev));
        event.currentTarget.previousElementSibling?.querySelector<HTMLElement>('td')?.focus();
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick?.(row);
    }
  }

  if (state === 'loading') {
    return (
      <div className="rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-5 py-10 text-center text-[var(--muted-foreground)]" role="status">
        {copy.loading}
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="panel-error rounded-[10px] px-5 py-10 text-center" role="alert">
        {errorMessage || copy.tableError}
      </div>
    );
  }
  if (state === 'empty' || sorted.length === 0) {
    return (
      <div className="rounded-[10px] border border-dashed border-[var(--hairline)] bg-[var(--surface)] px-5 py-10 text-center text-[var(--muted-foreground)]" role="status">
        {copy.emptyList}
      </div>
    );
  }

  return (
    <div className={cn('overflow-auto rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)]', className)}>
      {/* Fixed layout: with `auto`, a long CJK node name takes the width the
          numeric columns need and every other cell wraps to five lines. */}
      <table className="w-full table-fixed border-collapse text-body">
        <thead className="sticky top-0 z-10 bg-[var(--surface)]">
          <tr className="data-row border-b border-[var(--hairline)]">
            {columns.map((col) => (
              <th
                key={col.id}
                style={col.width ? { width: col.width } : undefined}
                className={cn(
                  'overflow-hidden px-3 whitespace-nowrap text-micro font-medium text-[var(--muted-foreground)]',
                  col.align === 'right' ? 'text-right' : 'text-left',
                  col.className,
                )}
              >
                {col.sortValue ? (
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center gap-1',
                      col.align === 'right' && 'flex-row-reverse',
                    )}
                    onClick={() => toggleSort(col.id)}
                  >
                    {col.header}
                    {sortId === col.id ? <span className="font-mono">{sortDir === 'asc' ? '↑' : '↓'}</span> : null}
                  </button>
                ) : col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => {
            const id = getRowId(row);
            const selected = selectedId === id;
            const focused = focusId === id;
            return (
              <tr
                key={id}
                tabIndex={0}
                data-selected={selected ? 'true' : 'false'}
                className={cn(
                  'data-row cursor-pointer border-b border-[var(--hairline)] last:border-b-0',
                  selected && 'row-selected',
                  focused && 'outline outline-1 outline-[var(--accent)]',
                )}
                onClick={() => onRowClick?.(row)}
                onKeyDown={(event) => onKey(event, index, row)}
                onFocus={() => setFocusId(id)}
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    tabIndex={-1}
                    className={cn(
                      'overflow-hidden px-3 align-middle whitespace-nowrap',
                      col.align === 'right' ? 'text-right' : 'text-left',
                      col.mono && 'font-mono',
                      col.className,
                    )}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
