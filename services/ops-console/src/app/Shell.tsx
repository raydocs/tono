import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Search, UserRound } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { copy } from '@/copy/copy';
import { cn } from '@/lib/utils';
import { BLANK_ROUTE, readRoute, writeRoute, type OpsRoute } from '@/lib/hash-route';
import { trafficRange } from '@/lib/api-traffic';
import { navigationContext } from '@/lib/navigation';
import { usePrivacy } from '@/lib/privacy';
import { consoleBehind, worstSource } from '@/lib/sources';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import type { FleetState } from '@/lib/use-fleet';
import type { Resource } from '@/lib/use-resource';
import type {
  CustomerSummaryDto,
  FunnelDto,
  IncidentDto,
  NodeSummaryDto,
  SystemHealthDto,
} from '@contract';
import { currentRole } from '@/lib/roles';
import '@/styles/shell.css';
import { CommandPalette } from './CommandPalette';
import { Enter } from './Enter';
import { Navigation } from './Navigation';

const THEMES: ThemeChoice[] = ['system', 'light', 'dark'];

export function Shell({
  children,
  fleet,
  health,
  fetchedAt,
  nodes,
  customers,
  funnel,
  incidents,
}: {
  children: ReactNode;
  fleet: FleetState;
  health: Resource<SystemHealthDto>;
  /** When the shell last heard back, across all of its reads. */
  fetchedAt: number | null;
  nodes: NodeSummaryDto[];
  customers: CustomerSummaryDto[];
  /** ⌘K searches the people who have no customer row too; null until it lands. */
  funnel: FunnelDto | null;
  incidents: IncidentDto[];
}) {
  const [route, setRoute] = useState<OpsRoute>(() => (
    typeof window === 'undefined' ? BLANK_ROUTE : readRoute()
  ));
  const privacy = usePrivacy();
  const theme = useTheme();
  const role = currentRole();
  const context = navigationContext(route, role);

  useEffect(() => {
    const sync = () => setRoute(readRoute());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const sources = useMemo(
    () => (health.status === 'ready' ? worstSource(health.data) : null),
    [health],
  );

  return (
    <div className="shell-root flex min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <Navigation route={route} role={role} />

      <div className="shell-frame flex min-w-0 flex-1 flex-col">
        <header className="shell-header flex h-14 items-center gap-3 border-b border-[var(--hairline)] bg-[var(--surface)] px-4 min-[960px]:px-6">
          <div className="shell-heading mr-auto min-w-0">
            <span className="text-fine text-[var(--muted-foreground)]">{context.group}</span>
            <h1 className="text-page truncate">{context.title}</h1>
          </div>
          <SearchBox />
          <SourcePill sources={sources} behind={consoleBehind(fetchedAt)} />
          <PreferencesMenu theme={theme} privacy={privacy} />
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

        <main className="shell-main flex-1">
          {route.legacyFilter ? <p className="px-6 py-3 text-fine" role="status">{copy.legacyFilterNotice}</p> : null}
          {route.returnToTraffic ? <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-fine">
            <button type="button" className="text-[color:var(--accent)] hover:underline"
              onClick={() => writeRoute({ ...BLANK_ROUTE, page: 'traffic', range: route.range })}>
              {copy.traffic.back(copy.traffic.range[trafficRange(route.range)])}
            </button><span>{copy.traffic.detailWindow}</span>
          </div> : null}
          <Enter>
            {children}
          </Enter>
        </main>
      </div>
      <CommandPalette
        nodes={nodes}
        customers={customers}
        funnel={funnel}
        incidents={incidents}
      />
    </div>
  );
}

/**
 * One control, not three.
 *
 * The box and the shortcut were separate elements sitting next to each other,
 * which read as two ways in and gave the eye two things to parse; the hint
 * belongs inside the field it describes. Focus opens the palette rather than
 * typing here, so the input is a door, and the `readOnly` says so to anyone
 * arriving by keyboard.
 */
function SearchBox() {
  return (
    <div className="relative">
      <button type="button" className="shell-search-mobile" aria-label={copy.searchPrompt}
        onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}>
        <Search size={18} aria-hidden />
      </button>
      <label className="sr-only" htmlFor="ops-search">{copy.searchPrompt}</label>
      <input
        id="ops-search"
        readOnly
        className="hidden min-[960px]:block h-8 w-64 rounded-[10px] border border-[var(--hairline)] bg-[var(--background)] pl-3 pr-12 text-body outline-none placeholder:text-[var(--muted-foreground)]"
        placeholder={copy.searchPrompt}
        onFocus={() => {
          const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
          window.dispatchEvent(event);
        }}
      />
      <kbd className="pointer-events-none hidden min-[960px]:block absolute right-2 top-1/2 -translate-y-1/2 rounded-[6px] border border-[var(--hairline)] px-1.5 py-0.5 font-mono text-micro text-[var(--muted-foreground)]">
        ⌘K
      </kbd>
    </div>
  );
}

/**
 * Theme and the privacy mask are preferences, not facts about the fleet, and
 * they were taking a third of the header to say so. Behind the avatar they
 * stay one click away and stop competing with the only two things the header
 * owes the operator: a way in, and how fresh the data is.
 */
function PreferencesMenu({
  theme,
  privacy,
}: {
  theme: ReturnType<typeof useTheme>;
  privacy: ReturnType<typeof usePrivacy>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={copy.preferences}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[999px] border border-[var(--hairline)] bg-[var(--background)] text-[var(--muted-foreground)] outline-none hover:text-[var(--foreground)]"
      >
        <UserRound size={14} strokeWidth={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-micro text-[var(--muted-foreground)]">
          {copy.appearance}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme.theme}
          onValueChange={(value) => theme.setTheme(value as ThemeChoice)}
        >
          {THEMES.map((id) => (
            <DropdownMenuRadioItem key={id} value={id} className="text-body">
              {copy.theme[id]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={privacy.privacy}
          onCheckedChange={(next) => privacy.setPrivacy(next === true)}
          className="text-body"
        >
          {copy.privacy}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Which source the page cannot be trusted about, in five words.
 *
 * It used to call the sources fine as soon as any one of them was ready, so a
 * nineteen-hour-old mainland sweep and a fresh read looked identical, and the
 * one thing the operator wanted to know — which feed is dead — was on no page
 * at all. Now the weakest source names itself, the rest are one hover away, and
 * the healthy word requires every source to be ready.
 *
 * `behind` outranks all of it: if the console itself has stopped hearing back,
 * nothing it knows about the sources is current either.
 */
function SourcePill({
  sources,
  behind,
}: {
  sources: ReturnType<typeof worstSource>;
  behind: boolean;
}) {
  const shell = 'source-pill raised rounded-[999px] bg-[var(--background)] px-2.5 py-1 text-micro';
  if (behind) {
    return <span className={cn(shell, 'tone-warn')}>{copy.consoleStale}</span>;
  }
  if (sources === null) {
    return <span className={cn(shell, 'tone-unk')}>{copy.sourceUnknown}</span>;
  }
  return (
    <span className={cn(shell, `tone-${sources.tone}`)} title={sources.title}>
      {sources.text}
    </span>
  );
}
