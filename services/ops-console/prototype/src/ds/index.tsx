import { AlertTriangle, Clock, Database, Inbox, Loader2, RotateCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { Tone } from '@proto/charts/core';
import { useProto } from '@proto/state';

export type { Tone };

const TONE_TEXT: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', sev: 'text-sev', info: 'text-info', idle: 'text-faint' };
const TONE_SOFT: Record<Tone, string> = { ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', sev: 'bg-sev-soft text-sev', info: 'bg-info-soft text-info', idle: 'bg-idle-soft text-muted' };
const TONE_DOT: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-warn', sev: 'bg-sev', info: 'bg-info', idle: 'bg-idle' };

export function toneText(t: Tone) { return TONE_TEXT[t]; }

export function Dot({ tone, pulse, label }: { tone: Tone; pulse?: boolean; label?: string }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-50', TONE_DOT[tone])} />}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', TONE_DOT[tone])} />
    </span>
  );
}

export function Badge({ tone = 'idle', children, dot }: { tone?: Tone; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn('inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 text-xs font-medium', TONE_SOFT[tone])}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', TONE_DOT[tone])} />}
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

type PanelProps = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Where the numbers come from; shown in the header and used for state. */
  source?: string;
  /** Age of the newest datum in minutes; past `staleAfter` the panel says so. */
  ageMin?: number;
  staleAfter?: number;
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
};

/** A region that scrolls sideways but holds nothing focusable gets a tab stop, so keyboard users can scroll it. */
function useKeyboardScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const sync = () => {
      const needs = el.scrollWidth > el.clientWidth + 1 && !el.querySelector('a, button, input, select, textarea, [tabindex]');
      if (needs) el.setAttribute('tabindex', '0'); else el.removeAttribute('tabindex');
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  });
  return ref;
}

/**
 * Every block of data on every page is a Panel. The panel, not the page,
 * owns loading, error and staleness, so one slow source never blanks a page.
 */
export function Panel({ title, description, actions, source, ageMin = 1, staleAfter = 15, flush, className, children }: PanelProps) {
  const { dataState } = useProto();
  const stale = dataState === 'stale' ? 42 : ageMin;
  const isStale = stale > staleAfter;
  const body = useKeyboardScroll<HTMLDivElement>();
  return (
    <section className={cn('flex min-w-0 flex-col rounded-lg border border-line bg-panel', className)}>
      {(title || actions) && (
        <header className="flex min-h-11 items-center gap-3 border-b border-line px-4 py-2">
          <div className="min-w-0 flex-1">
            {title && <h2 className="truncate text-sm font-medium">{title}</h2>}
            {description && <p className="truncate text-xs text-faint">{description}</p>}
          </div>
          {source && <Freshness source={source} ageMin={stale} stale={isStale} />}
          {actions}
        </header>
      )}
      <div ref={flush ? body : undefined} className={cn('min-w-0 flex-1', flush ? 'overflow-x-auto' : 'p-4')}>
        {dataState === 'loading' ? <div className={cn(flush && 'p-4')}><Loading /></div>
          : dataState === 'error' ? <div className={cn(flush && 'p-4')}><ErrorState source={source} /></div>
            : children}
      </div>
    </section>
  );
}

export function Freshness({ source, ageMin, stale }: { source: string; ageMin: number; stale: boolean }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-2xs', stale ? 'text-warn' : 'text-faint')} title={`数据源：${source}`}>
      {stale ? <Clock size={12} /> : <Database size={11} />}
      <span className="hidden sm:inline">{source}</span>
      <span className="num">· {ageMin < 1 ? '刚刚' : `${ageMin} 分钟前`}</span>
      {stale && <span>· 已陈旧</span>}
    </span>
  );
}

export function Stat({ label, value, sub, tone, children, href }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone; children?: React.ReactNode; href?: string;
}) {
  const { dataState } = useProto();
  const body = (
    <>
      <div className="text-xs text-muted">{label}</div>
      {dataState === 'loading' ? <div className="skeleton mt-2 h-6 w-20" />
        : dataState === 'error' ? <div className="mt-1 text-2xl font-semibold text-faint">—</div>
          : <div className={cn('mt-1 text-2xl font-semibold tracking-tight num', tone && TONE_TEXT[tone])}>{value}</div>}
      {sub && dataState === 'ready' && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
      {sub && dataState === 'stale' && <div className="mt-0.5 text-xs text-warn">{sub} · 42 分钟前</div>}
      {children && dataState !== 'loading' && dataState !== 'error' && <div className="mt-2">{children}</div>}
    </>
  );
  const cls = 'min-w-0 rounded-lg border border-line bg-panel px-4 py-3';
  return href ? <a href={href} className={cn(cls, 'transition-colors hover:border-line-strong')}>{body}</a> : <div className={cls}>{body}</div>;
}

export function Segmented<T extends string>({ value, options, onChange, size = 'sm', label }: {
  value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void; size?: 'sm' | 'xs'; label?: string;
}) {
  function onKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
    onChange(next.value);
    (e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
  }
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey} className="inline-flex max-w-full overflow-x-auto rounded-md border border-line bg-panel-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          data-value={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 font-medium transition-colors',
            size === 'sm' ? 'h-7 text-xs' : 'h-6 text-2xs',
            o.value === value ? 'bg-panel text-fg shadow-[0_0_0_1px_var(--line)]' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
          {o.count != null && <span className="text-faint num">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Button({ children, variant = 'default', size = 'sm', onClick, href, icon, disabled, loading, label, type = 'button' }: {
  children?: React.ReactNode; variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'danger-solid'; size?: 'sm' | 'xs';
  onClick?: () => void; href?: string; icon?: React.ReactNode; disabled?: boolean; loading?: boolean;
  /** Required when the button is icon-only. */
  label?: string; type?: 'button' | 'submit';
}) {
  const cls = cn(
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'h-8 px-3 text-sm' : 'h-7 px-2.5 text-xs',
    !children && (size === 'sm' ? 'w-8 px-0' : 'w-7 px-0'),
    variant === 'primary' && 'bg-accent text-accent-fg hover:opacity-90',
    variant === 'default' && 'border border-line bg-panel hover:bg-hover',
    variant === 'ghost' && 'text-muted hover:bg-hover hover:text-fg',
    variant === 'danger' && 'border border-line bg-panel text-sev hover:bg-sev-soft',
    variant === 'danger-solid' && 'bg-sev text-accent-fg hover:opacity-90',
  );
  const inner = <>{loading ? <Loader2 size={size === 'sm' ? 14 : 12} className="animate-spin" aria-hidden /> : icon}{children}</>;
  if (href) return <a href={href} className={cls} aria-label={label}>{inner}</a>;
  return <button type={type} onClick={onClick} className={cls} disabled={disabled || loading} aria-label={label} aria-busy={loading || undefined}>{inner}</button>;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-panel-2 px-1 text-2xs font-medium text-muted num">{children}</kbd>;
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded" style={{ background: i.dashed ? `repeating-linear-gradient(90deg, ${i.color} 0 3px, transparent 3px 5px)` : i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/* ---------- states ---------- */

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2.5" aria-busy>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-4" style={{ width: `${92 - i * 13}%` }} />)}
    </div>
  );
}

export function ErrorState({ source }: { source?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-dashed border-sev/40 bg-sev-soft/40 px-3 py-3 text-sm">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-sev" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">读不到{source ? ` ${source}` : '数据'}</div>
        <div className="text-xs text-muted">接口返回 500。页面其它部分不受影响，这一块不显示旧数字。</div>
      </div>
      <Button size="xs" icon={<RotateCw size={12} />}>重试</Button>
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
      <Inbox size={20} className="text-faint" />
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="max-w-sm text-xs text-muted">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** For data the Worker does not collect yet: a line of text, never an empty chart. */
export function NotWired({ what, needs }: { what: string; needs: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-dashed border-line px-3 py-2.5 text-xs text-muted">
      <Database size={14} className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1"><span className="text-fg">{what}</span> 还没有数据源 · {needs}</span>
      <Badge>未接入</Badge>
    </div>
  );
}
