import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Copy, Loader2, X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { cn } from '@/lib/utils';
import { Button, type Tone } from './index';

/* ---------- Drawer ---------- */

/**
 * Overlays open from buttons and table rows, not Radix triggers, so Radix
 * cannot return focus on close. Remember what had focus when it opened.
 */
function useReturnFocus(open: boolean) {
  const back = useRef<HTMLElement | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) back.current = document.activeElement as HTMLElement | null;
  }
  return (e: Event) => {
    const el = back.current;
    if (el && el.isConnected) { e.preventDefault(); el.focus(); }
  };
}

/**
 * Details open to the right and keep the list visible behind them, so the
 * operator never loses their place. 520 px for a record, 720 px for a record
 * with a table in it; full width below 640 px.
 */
export function Drawer({ open, onOpenChange, title, subtitle, meta, wide, footer, children }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  title: React.ReactNode; subtitle?: React.ReactNode; meta?: React.ReactNode;
  wide?: boolean; footer?: React.ReactNode; children: React.ReactNode;
}) {
  const onCloseAutoFocus = useReturnFocus(open);
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fade-in fixed inset-0 z-40 bg-black/25 dark:bg-black/50" />
        <D.Content
          {...(subtitle ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).focus(); }}
          onCloseAutoFocus={onCloseAutoFocus}
          className={cn('drawer-in fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-panel focus:outline-none', wide ? 'sm:max-w-[720px]' : 'sm:max-w-[520px]')}
          style={{ boxShadow: 'var(--shadow-pop)' }}
        >
          <header className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <D.Title className="truncate text-base font-semibold">{title}</D.Title>
              {subtitle && <D.Description className="mt-0.5 text-xs text-muted">{subtitle}</D.Description>}
              {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
            </div>
            <D.Close aria-label="关闭" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
              <X size={15} />
            </D.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-panel-2 px-5 py-3">{footer}</footer>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="flex-1 text-xs font-medium uppercase tracking-wide text-muted">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function KV({ rows }: { rows: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[112px_1fr] gap-x-3 gap-y-2 text-sm">
      {rows.map(([k, v], i) => [
        <dt key={`k${i}`} className="text-muted">{k}</dt>,
        <dd key={`v${i}`} className="min-w-0 break-words">{v}</dd>,
      ])}
    </dl>
  );
}

export function Code({ value, label = 'JSON' }: { value: unknown; label?: string }) {
  const toast = useToast();
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div className="overflow-hidden rounded-md border border-line bg-panel-2">
      <div className="flex items-center border-b border-line px-3 py-1.5 text-2xs text-faint">
        <span className="flex-1">{label}</span>
        <button type="button" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover hover:text-fg"
          onClick={() => { void navigator.clipboard?.writeText(text).catch(() => undefined); toast('已复制', 'ok'); }}>
          <Copy size={11} /> 复制
        </button>
      </div>
      <pre tabIndex={0} aria-label={label} className="max-h-80 overflow-auto p-3 text-xs leading-5 num">{text}</pre>
    </div>
  );
}

/** Field-level change: before struck through, after highlighted. */
export function Diff({ rows }: { rows: { field: string; before: string | null; after: string | null }[] }) {
  return (
    <table className="w-full overflow-hidden rounded-md border border-line text-xs">
      <thead><tr className="bg-panel-2 text-left text-muted"><th className="px-3 py-1.5 font-medium">字段</th><th className="px-3 py-1.5 font-medium">改前</th><th className="px-3 py-1.5 font-medium">改后</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.field} className="border-t border-line align-top">
          <td className="px-3 py-2 text-muted num">{r.field}</td>
          <td className="px-3 py-2 num">{r.before == null ? <span className="text-faint">（无）</span> : <span className="rounded-sm bg-sev-soft px-1 text-sev line-through decoration-sev/60">{r.before}</span>}</td>
          <td className="px-3 py-2 num">{r.after == null ? <span className="text-faint">（删除）</span> : <span className="rounded-sm bg-ok-soft px-1 text-ok">{r.after}</span>}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

/* ---------- Progress ---------- */

export type StepState = 'todo' | 'active' | 'done' | 'fail';

export function Steps({ steps, states }: { steps: string[]; states: StepState[] }) {
  return (
    <ol className="flex flex-col gap-2" aria-live="polite">
      {steps.map((s, i) => {
        const st = states[i] ?? 'todo';
        return (
          <li key={s} className={cn('flex items-center gap-2.5 text-sm', st === 'todo' && 'text-faint')}>
            <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full border',
              st === 'done' && 'border-ok bg-ok text-white', st === 'active' && 'border-accent text-accent',
              st === 'fail' && 'border-sev bg-sev text-white', st === 'todo' && 'border-line-strong')}>
              {st === 'done' ? <Check size={12} /> : st === 'active' ? <Loader2 size={12} className="animate-spin" /> : st === 'fail' ? <X size={12} /> : <span className="text-2xs num">{i + 1}</span>}
            </span>
            <span className="flex-1">{s}</span>
            <span className="sr-only">{st === 'done' ? '已完成' : st === 'active' ? '进行中' : st === 'fail' ? '失败' : '未开始'}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Walks through the steps on a timer; the prototype's stand-in for polling a job. `failAt` stops there with a failure. */
export function useSteps(count: number, ms = 800, failAt?: number) {
  const [at, setAt] = useState(-1);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const tick = useCallback((i: number, fail: number | undefined) => {
    setAt(i);
    if (i === fail) { setFailed(true); return; }
    if (i < count) timer.current = window.setTimeout(() => tick(i + 1, fail), ms);
  }, [count, ms]);
  const states: StepState[] = Array.from({ length: count }, (_, i) => (at < 0 || i > at ? 'todo' : i < at ? 'done' : failed ? 'fail' : at >= count ? 'done' : 'active'));
  return {
    states, failed,
    running: at >= 0 && at < count && !failed,
    done: at >= count,
    start: () => { setFailed(false); tick(0, failAt); },
    retry: () => { setFailed(false); tick(0, undefined); },
    reset: () => { if (timer.current) window.clearTimeout(timer.current); setAt(-1); setFailed(false); },
  };
}

/* ---------- Confirm ---------- */

/**
 * Three levels. Plain: one click. Danger: red button and the impact spelled
 * out. Irreversible: the operator types the name of the thing first. After
 * confirming, the same dialog shows the job's steps until it finishes.
 */
export function Confirm({ open, onOpenChange, title, description, impact, action, tone = 'default', typed, blocked, steps, failAt, failText, doneText, onDone }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  title: string; description: React.ReactNode; impact?: React.ReactNode; action: string;
  tone?: 'default' | 'danger'; typed?: string; blocked?: boolean; steps?: string[];
  /** Step index where the job fails, with what the operator should do next. */
  failAt?: number; failText?: React.ReactNode;
  doneText?: string; onDone?: () => void;
}) {
  const [text, setText] = useState('');
  const job = useSteps(steps?.length ?? 0, 800, failAt);
  const toast = useToast();
  const started = job.running || job.done || job.failed;
  const onCloseAutoFocus = useReturnFocus(open);
  const ready = !blocked && (!typed || text.trim() === typed);
  useEffect(() => { if (!open) { setText(''); job.reset(); } }, [open]);
  useEffect(() => { if (job.done && steps?.length) { toast(doneText ?? `${title}：完成`, 'ok'); onDone?.(); } }, [job.done]);
  function confirm() {
    if (!ready) return;
    if (steps?.length) job.start();
    else { onOpenChange(false); toast(doneText ?? `${title}：已提交`, 'ok'); onDone?.(); }
  }
  return (
    <D.Root open={open} onOpenChange={(v) => { if (!job.running) onOpenChange(v); }}>
      <D.Portal>
        <D.Overlay className="fade-in fixed inset-0 z-50 bg-black/30 dark:bg-black/55" />
        <D.Content role="alertdialog" onCloseAutoFocus={onCloseAutoFocus} className="pop-in fixed left-1/2 top-[18vh] z-50 w-[calc(100vw-32px)] max-w-[480px] -translate-x-1/2 rounded-xl border border-line bg-panel p-5 focus:outline-none" style={{ boxShadow: 'var(--shadow-pop)' }}>
          <div className="flex items-start gap-3">
            {tone === 'danger' && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-sev-soft text-sev"><CircleAlert size={16} /></span>}
            <div className="min-w-0 flex-1">
              <D.Title className="text-base font-semibold">{title}</D.Title>
              <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>
            </div>
          </div>
          {impact && !started && <div className="mt-4 rounded-md border border-line bg-panel-2 px-3 py-2.5 text-sm">{impact}</div>}
          {typed && !started && (
            <label className="mt-4 block text-sm">
              <span className="text-muted">输入 <span className="rounded bg-hover px-1 font-medium text-fg num">{typed}</span> 确认</span>
              <input autoFocus className="field-input mt-1.5" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }} aria-invalid={text !== '' && !ready} />
            </label>
          )}
          {steps && started && <div className="mt-4"><Steps steps={steps} states={job.states} /></div>}
          {job.failed && <div role="alert" className="mt-4 rounded-md border border-sev/40 bg-sev-soft px-3 py-2.5 text-sm">{failText ?? '这一步失败了，前面的步骤已生效；可以重试。'}</div>}
          <div className="mt-5 flex justify-end gap-2">
            {job.failed ? <><Button onClick={() => onOpenChange(false)}>关闭</Button><Button variant="primary" onClick={job.retry}>重试</Button></>
              : job.done ? <Button variant="primary" onClick={() => onOpenChange(false)}>完成</Button> : <>
              <Button onClick={() => onOpenChange(false)} disabled={job.running}>取消</Button>
              <Button variant={tone === 'danger' ? 'danger-solid' : 'primary'} onClick={confirm} disabled={!ready} loading={job.running}>{job.running ? '进行中' : action}</Button>
            </>}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/* ---------- Toast ---------- */

type ToastItem = { id: number; text: string; tone: Tone };
const ToastCtx = createContext<(text: string, tone?: Tone) => void>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
        {items.map((t) => (
          <div key={t.id} className="pop-in pointer-events-auto flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm" style={{ boxShadow: 'var(--shadow-pop)' }}>
            <span className={cn('h-2 w-2 rounded-full', t.tone === 'ok' ? 'bg-ok' : t.tone === 'sev' ? 'bg-sev' : t.tone === 'warn' ? 'bg-warn' : 'bg-info')} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
