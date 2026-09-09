import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Monitor, Server, Settings, SunMoon, Users } from 'lucide-react';
import { copy, type PageId } from '@/copy/copy';
import { cn } from '@/lib/utils';
import { formatClock } from '@/lib/display';
import { goPage, readRoute, type OpsRoute } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { sourceStamp, type FleetState } from '@/lib/use-fleet';
import type { FleetNodeDto } from '@/lib/types';
import { CommandPalette } from './CommandPalette';
import { Enter } from './Enter';

const NAV: Array<{ id: PageId; icon: typeof Server }> = [
  { id: 'today', icon: SunMoon },
  { id: 'nodes', icon: Server },
  { id: 'customers', icon: Users },
  { id: 'clients', icon: Monitor },
  { id: 'settings', icon: Settings },
];

const THEMES: ThemeChoice[] = ['system', 'light', 'dark'];

export function Shell({
  children,
  fleet,
  nodes,
}: {
  children: ReactNode;
  fleet: FleetState;
  nodes: FleetNodeDto[];
}) {
  const [route, setRoute] = useState<OpsRoute>(() => (
    typeof window === 'undefined' ? { page: 'today', node: null } : readRoute()
  ));
  const privacy = usePrivacy();
  const theme = useTheme();

  useEffect(() => {
    const sync = () => setRoute(readRoute());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const stamp = useMemo(
    () => sourceStamp(fleet.status === 'ready' ? fleet.fleet : null),
    [fleet],
  );

  return (
    <div className="flex min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <aside className="flex w-52 shrink-0 flex-col border-r border-[var(--hairline)] bg-[var(--surface)]">
        <div className="flex items-center gap-2 border-b border-[var(--hairline)] px-5 py-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[var(--accent)] text-[11px] font-medium text-white">T</span>
          <div>
            <div className="text-row leading-none">{copy.brand}</div>
            <div className="text-micro text-[var(--muted-foreground)]">{copy.brandSub}</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label={copy.brand}>
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = route.page === item.id;
            return (
              <a
                key={item.id}
                href={`#/${item.id}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-[10px] px-3 py-2 text-body transition-transform duration-150',
                  active ? 'bg-[var(--background)] font-medium' : 'text-[var(--muted-foreground)] hover:-translate-y-px',
                )}
                onClick={(event) => {
                  event.preventDefault();
                  goPage(item.id);
                }}
              >
                <Icon size={16} strokeWidth={1.75} />
                {copy.pages[item.id]}
              </a>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-[var(--hairline)] bg-[var(--surface)] px-6">
          <h1 className="text-page mr-auto">{copy.pages[route.page]}</h1>
          <label className="sr-only" htmlFor="ops-search">{copy.searchPrompt}</label>
          <input
            id="ops-search"
            className="h-8 w-56 rounded-[10px] border border-[var(--hairline)] bg-[var(--background)] px-3 text-body outline-none placeholder:text-[var(--muted-foreground)]"
            placeholder={copy.searchPrompt}
            onFocus={() => {
              const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
              window.dispatchEvent(event);
            }}
          />
          <kbd className="hidden rounded-[8px] border border-[var(--hairline)] px-1.5 py-0.5 font-mono text-micro text-[var(--muted-foreground)] sm:inline">⌘K</kbd>
          <select
            aria-label={copy.theme.system}
            className="h-8 rounded-[10px] border border-[var(--hairline)] bg-[var(--background)] px-2 text-body"
            value={theme.theme}
            onChange={(event) => theme.setTheme(event.target.value as ThemeChoice)}
          >
            {THEMES.map((id) => (
              <option key={id} value={id}>{copy.theme[id]}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-body">
            <input
              type="checkbox"
              checked={privacy.privacy}
              onChange={(event) => privacy.setPrivacy(event.target.checked)}
            />
            {copy.privacy}
          </label>
          <SourcePill ok={stamp.ok} at={stamp.at} />
        </header>

        {fleet.status === 'error' && fleet.sessionExpired ? (
          <div className="flex items-center justify-between gap-4 border-b border-[hsl(var(--sev-line)/0.35)] bg-[hsl(var(--sev-bg))] px-6 py-3 text-[hsl(var(--sev-fg))]" role="alert">
            <span>{copy.sessionExpiredBody}</span>
            <button
              type="button"
              className="rounded-[999px] bg-[var(--accent)] px-3 py-1 text-micro text-white hover:bg-[var(--accent-hover)]"
              onClick={() => window.location.reload()}
            >
              {copy.reload}
            </button>
          </div>
        ) : null}

        <main className="flex-1">
          <Enter>
            {children}
          </Enter>
        </main>
      </div>
      <CommandPalette nodes={nodes} />
    </div>
  );
}

function SourcePill({ ok, at }: { ok: boolean; at: number | null }) {
  if (!ok || at == null) {
    return (
      <span className="rounded-[999px] border border-[var(--hairline)] bg-[var(--background)] px-2.5 py-1 text-micro text-[var(--muted-foreground)]">
        {copy.sourceUnknown}
      </span>
    );
  }
  return (
    <span className="rounded-[999px] border border-[var(--hairline)] bg-[var(--background)] px-2.5 py-1 text-micro">
      {copy.sourceOk} · <span className="font-mono">{formatClock(at)}</span>
    </span>
  );
}
