import { useEffect, useRef, type ReactNode, type SVGProps } from 'react';
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
      <span className="muted">{label}</span>
    </div>
  );
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return <div className="state"><strong>{title}</strong>{detail ? <span>{detail}</span> : null}</div>;
}

export function Unavailable({ title, detail }: { title: string; detail?: string }) {
  return <div className="state state-error"><strong>{title}</strong>{detail ? <span>{detail}</span> : null}</div>;
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
    <div className="filter-chips">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`chip${value === option.id ? ' chip-ok' : ''}`}
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
  return <div className={`banner banner-${tone}`}>{message}</div>;
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
  const panel = useRef<HTMLElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const previously = document.activeElement as HTMLElement | null;
    const shell = document.querySelector('.shell');
    shell?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    closeBtn.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
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
      shell?.removeAttribute('inert');
      document.body.style.overflow = '';
      previously?.focus?.();
    };
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="drawer-root">
      <button type="button" className="drawer-scrim" aria-label="关闭" onClick={onClose} />
      <aside ref={panel} className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-head">
          <div>
            <h2 id="drawer-title">{title}</h2>
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
  onCancel,
  onConfirm,
}: {
  title: string;
  detail?: string;
  confirmLabel?: string;
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="drawer-root">
      <button type="button" className="drawer-scrim" aria-label="取消" onClick={onCancel} />
      <aside className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        {detail ? <p>{detail}</p> : null}
        <div className="form-row">
          <button type="button" className="btn btn-outline" onClick={onCancel}>取消</button>
          <button type="button" className="btn" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
