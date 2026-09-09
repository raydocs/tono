import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Monitor, Server, Settings, SunMoon, Users } from 'lucide-react';
import { copy, type PageId } from '@/copy/copy';
import { cn } from '@/lib/utils';
import { formatWhen, formatWhenAgo } from '@/lib/display';
import { BLANK_ROUTE, goPage, readRoute, type OpsRoute } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { sourceStamp, type FleetState } from '@/lib/use-fleet';
import type { CustomerSummaryDto, IncidentDto } from '@contract';
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
  customers,
  incidents,
}: {
  children: ReactNode;
  fleet: FleetState;
  nodes: FleetNodeDto[];
  customers: CustomerSummaryDto[];
  incidents: IncidentDto[];
}) {
  const [route, setRoute] = useState<OpsRoute>(() => (
    typeof window === 'undefined' ? BLANK_ROUTE : readRoute()
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
      {/* Below 960 the rail keeps the icons and drops the words: a 208 px
          sidebar leaves nothing for the page on a 390 px screen. */}
      <aside className="flex w-14 shrink-0 flex-col border-r border-[var(--hairline)] bg-[var(--surface)] min-[960px]:w-52">
        <div className="flex items-center gap-2 border-b border-[var(--hairline)] px-3 py-4 min-[960px]:px-5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--accent)] text-[11px] font-medium text-white">T</span>
          <div className="hidden min-[960px]:block">
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
                title={copy.pages[item.id]}
                className={cn(
                  'flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-body transition-transform duration-150 min-[960px]:px-3',
                  active ? 'bg-[var(--background)] font-medium' : 'text-[var(--muted-foreground)] hover:-translate-y-px',
                )}
                onClick={(event) => {
                  event.preventDefault();
                  goPage(item.id);
                }}
              >
                <Icon size={16} strokeWidth={1.75} className="shrink-0" />
                <span className="hidden min-[960px]:inline">{copy.pages[item.id]}</span>
              </a>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-[var(--hairline)] bg-[var(--surface)] px-4 min-[960px]:px-6">
          <h1 className="text-page mr-auto truncate">{copy.pages[route.page]}</h1>
          <label className="sr-only" htmlFor="ops-search">{copy.searchPrompt}</label>
          <input
            id="ops-search"
            className="hidden h-8 w-56 rounded-[10px] border border-[var(--hairline)] bg-[var(--background)] px-3 text-body outline-none placeholder:text-[var(--muted-foreground)] min-[960px]:block"
            placeholder={copy.searchPrompt}
            onFocus={() => {
              const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
              window.dispatchEvent(event);
            }}
          />
          <kbd className="hidden rounded-[8px] border border-[var(--hairline)] px-1.5 py-0.5 font-mono text-micro text-[var(--muted-foreground)] min-[960px]:inline">⌘K</kbd>
          <select
            aria-label={copy.theme.system}
            className="hidden h-8 rounded-[10px] border border-[var(--hairline)] bg-[var(--background)] px-2 text-body min-[960px]:block"
            value={theme.theme}
            onChange={(event) => theme.setTheme(event.target.value as ThemeChoice)}
          >
            {THEMES.map((id) => (
              <option key={id} value={id}>{copy.theme[id]}</option>
            ))}
          </select>
          <label className="hidden items-center gap-1.5 text-body min-[960px]:flex">
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
          <div className="banner-alert flex items-center justify-between gap-4 px-6 py-3" role="alert">
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
      <CommandPalette nodes={nodes} customers={customers} incidents={incidents} />
    </div>
  );
}

/**
 * How stale the fleet is, in words. "03:23" told the operator the clock time
 * of the last read but not whether that was a minute or a day ago, which is
 * the only thing this pill exists to answer; the exact stamp moves to the
 * tooltip. With no `sources` in the response there is nothing to be sure
 * about, so the pill goes grey and says so rather than implying freshness.
 */
function SourcePill({ ok, at }: { ok: boolean; at: number | null }) {
  if (!ok || at == null) {
    return (
      <span className="rounded-[999px] border border-[var(--hairline)] bg-[var(--background)] px-2.5 py-1 text-micro text-[var(--muted-foreground)]">
        {copy.sourceUnknown}
      </span>
    );
  }
  return (
    <span
      className="rounded-[999px] border border-[var(--hairline)] bg-[var(--background)] px-2.5 py-1 text-micro"
      title={formatWhen(at)}
    >
      {copy.sourceOk} · <span className="font-mono normal-case tracking-normal">{formatWhenAgo(at)}</span>
    </span>
  );
}
