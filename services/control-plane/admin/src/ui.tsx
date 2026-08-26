import { useEffect, useId, useRef, type ReactNode, type SVGProps } from 'react';
import { createPortal } from 'react-dom';
import type { Live, Resource } from './hooks';
import { dataHealthLines } from './lib/health';

export function Icon({ d, ...props }: SVGProps<SVGSVGElement> & { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-icon" aria-hidden {...props}>
      <path d={d} />
    </svg>
  );
}

export const icons = {
  dashboard: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1',
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  monitor: 'M22 12h-4l-3 9L9 3l-3 9H2',
  failures: 'M10.3 2.9L1.8 17a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 2.9a2.5 2.5 0 00-4.4 0zM12 9v4M12 17h.01',
  traffic: 'M4 19V9M10 19V5M16 19v-7M22 19V2',
  control: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
} as const;

export const statusLabels: Record<string, string> = {
  active: '正常',
  disabled: '已注销',
  retired: '停用',
  banned: '已封号',
  assigned: '在用',
  pooled: '库存',
  pending: '待确认',
  revoked: '已撤销',
  degraded: '异常',
  failed: '失败',
  alive: '通',
  dead: '不通',
  untested: '未测',
};

export function Status({ value }: { value: string }) {
  const key = value.replaceAll('_', '-');
  return <span className={`status status-${key}`}>{statusLabels[value] ?? value.replaceAll('_', ' ')}</span>;
}

export function StateBoundary<T>({ resource, empty, children }: {
  resource: Resource<T>;
  empty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (resource.state === 'loading') {
    return <Skeleton label="正在加载" />;
  }
  if (resource.state === 'error') {
    return <Unavailable title="无法加载" detail={resource.message} />;
  }
  if (empty?.(resource.data)) {
    return <Empty title="还没有内容" detail="这里暂时是空的。" />;
  }
  return children(resource.data);
}

export function Skeleton({ label = '正在加载' }: { label?: string }) {
  return (
    <div className="state skeleton-state" aria-busy="true">
      <div className="skeleton-block" />
      <div className="skeleton-block short" />
      <div className="skeleton-block" />
      <span className="muted skeleton-label"><span className="spinner" aria-hidden />{label}</span>
    </div>
  );
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="state t-unknown">
      <span className="state-mark" aria-hidden>∅</span>
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

export function Unavailable({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="state state-error t-severe" role="status">
      <span className="state-mark" aria-hidden>!</span>
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

/* —— Drawer primitives ——————————————————————————————————————————————————
 * The drawers held the console's densest content in the loosest markup: bare
 * paragraphs for readings, placeholders standing in for form labels, and
 * `<details>` whose summary carried an `<h3>`. These four give every drawer the
 * same skeleton — a titled block, a reading grid, a stated gap, a labelled
 * field — so the shell and its contents finally agree.
 */

export function DrawerSection({
  title,
  aside,
  fold = false,
  open: initiallyOpen = false,
  danger = false,
  children,
}: {
  title: string;
  aside?: ReactNode;
  /** Render as a disclosure. Long or rarely-read blocks only. */
  fold?: boolean;
  open?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  const head = (
    <div className="drawer-head-row">
      <h3>{title}</h3>
      {aside ? <div className="drawer-head-aside">{aside}</div> : null}
    </div>
  );
  if (fold) {
    return (
      <details className={`drawer-section drawer-fold${danger ? ' danger-zone' : ''}`} open={initiallyOpen}>
        <summary>{head}</summary>
        <div className="drawer-fold-body">{children}</div>
      </details>
    );
  }
  return (
    <section className={`drawer-section${danger ? ' danger-zone' : ''}`}>
      {head}
      {children}
    </section>
  );
}

/** A reading: what it is, what it says, and where the number came from. */
export function Stat({ label, value, note, tone }: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'severe' | 'warn' | 'ok' | 'info' | 'unknown';
}) {
  return (
    <div className={`stat${tone ? ` t-${tone}` : ''}${tone ? ' stat-toned' : ''}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {note ? <small className="stat-note">{note}</small> : null}
    </div>
  );
}

export function StatGrid({ children, columns }: { children: ReactNode; columns?: 2 | 3 }) {
  return <div className={`stat-grid${columns ? ` stat-grid-${columns}` : ''}`}>{children}</div>;
}

/**
 * Why a reading is missing, or what an action will actually do. Never an alarm:
 * the tone rail defaults to unknown so an absent measurement does not borrow
 * the colour of a real failure.
 */
export function Note({ tone = 'unknown', children }: {
  tone?: 'severe' | 'warn' | 'ok' | 'info' | 'unknown';
  children: ReactNode;
}) {
  return <p className={`note t-${tone}`}>{children}</p>;
}

/** A labelled control. A placeholder is a hint, not a label. */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <small className="field-hint">{hint}</small> : null}
    </label>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="field-grid">{children}</div>;
}

export function GlassCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`.trim()}>{children}</section>;
}

export function FilterChips({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (id: string) => void;
}) {
  return (
    <div className="filter-chips" role="group" aria-label="筛选">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`chip${value === option.id ? ' chip-ok' : ''}`}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Renders what `dataHealthLines` has to say about this page's sources. The
 * reasoning for saying it at all lives with that function.
 */
export function DataHealth({ sources }: {
  sources: Array<{ label: string; resource: Live<unknown> }>;
}) {
  const lines = dataHealthLines(
    sources.map(({ label, resource }) => ({
      label,
      state: resource.state,
      stale: resource.stale,
      refreshedAt: resource.refreshedAt,
    })),
    Date.now(),
  );
  if (!lines.length) return null;
  return <Banner tone="error" message={lines.join(' ')} />;
}

export function Banner({ message, tone = 'info' }: { message: string | null; tone?: 'info' | 'error' | 'ok' }) {
  if (!message) return null;
  return <div className={`banner banner-${tone}`} role="status" aria-live={tone === 'error' ? 'assertive' : 'polite'}>{message}</div>;
}

export function Drawer({
  title,
  subtitle,
  open,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const previously = document.activeElement as HTMLElement | null;
    const shell = document.querySelector('.shell');
    const previousInert = shell?.hasAttribute('inert') ?? false;
    const previousOverflow = document.body.style.overflow;
    shell?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    closeBtn.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.querySelector('[data-modal="confirm"]')) return;
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )].filter((node) => !node.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (shell && !previousInert) shell.removeAttribute('inert');
      else if (shell && previousInert) shell.setAttribute('inert', '');
      document.body.style.overflow = previousOverflow;
      previously?.focus?.();
    };
  }, [open]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="drawer-root">
      <button type="button" className="drawer-scrim" aria-label="关闭" onClick={onClose} />
      <aside ref={panel} className="drawer" data-modal="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="drawer-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button ref={closeBtn} type="button" className="btn btn-outline btn-sm" onClick={onClose}>关闭</button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

export function Confirm({
  title,
  detail,
  confirmLabel = '确认',
  open,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: {
  title: string;
  detail?: string;
  confirmLabel?: string;
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  onCancelRef.current = onCancel;
  busyRef.current = busy;
  useEffect(() => {
    if (!open) return undefined;
    const previously = document.activeElement as HTMLElement | null;
    const behind = document.querySelector<HTMLElement>('[data-modal="drawer"]')
      ?? document.querySelector<HTMLElement>('.shell');
    const previousInert = behind?.hasAttribute('inert') ?? false;
    const previousOverflow = document.body.style.overflow;
    behind?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    confirmBtn.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!busyRef.current) onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )].filter((node) => !node.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (behind && !previousInert) behind.removeAttribute('inert');
      else if (behind && previousInert) behind.setAttribute('inert', '');
      document.body.style.overflow = previousOverflow;
      previously?.focus?.();
    };
  }, [open]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="drawer-root" data-modal="confirm">
      <button type="button" className="drawer-scrim" aria-label="取消" onClick={() => { if (!busy) onCancel(); }} />
      <aside ref={panel} className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        {detail ? <p>{detail}</p> : null}
        {error ? <p className="confirm-error">{error}</p> : null}
        <div className="form-row">
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>取消</button>
          <button ref={confirmBtn} type="button" className="btn" onClick={() => { if (!busy) onConfirm(); }} disabled={busy}>
            {busy ? '处理中…' : confirmLabel}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
