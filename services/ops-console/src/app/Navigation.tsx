import { useState } from 'react';
import { Bell, BookOpen, Building2, FileClock, Globe, House, ListFilter, Monitor, MoreHorizontal,
  Network, Server, ShieldCheck, SunMoon, Users, Wallet, X } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { copy } from '@/copy/copy';
import type { OpsRoute } from '@/lib/hash-route';
import { isNavigationActive, openNavigation, visibleNavigation, type NavigationGroup, type NavigationItem } from '@/lib/navigation';
import type { OpsRole } from '@/lib/roles';

const ICONS = {
  today: SunMoon, nodes: Server, customers: Users, clients: Monitor,
  alerts: Bell, catalog: BookOpen, policy: Network, homeinventory: Globe,
  homelines: House, ledger: Wallet, providers: Building2, candidates: ListFilter,
  allowlist: ShieldCheck, audit: FileClock,
};
const DOCK_IDS = ['today', 'nodes', 'customers', 'clients'];

export function Navigation({ route, role }: { route: OpsRoute; role: OpsRole }) {
  const [more, setMore] = useState(false);
  const groups = visibleNavigation(role);
  const dock = DOCK_IDS.flatMap((id) => groups.flatMap((group) => group.items.filter((item) => item.id === id)));
  return (
    <>
      <aside className="shell-sidebar" aria-label={copy.navigation.label}>
        <div className="sidebar-brand"><span className="rail-brand" aria-hidden>T</span>
          <div><strong>{copy.brand}</strong><span>{copy.brandSub}</span></div>
        </div>
        <NavigationList groups={groups} route={route} />
      </aside>
      <nav className="shell-dock" aria-label={copy.navigation.label}>
        {dock.map((item) => <NavigationLink key={item.id} item={item} route={route} />)}
        <Sheet open={more} onOpenChange={setMore}>
          <SheetTrigger className="navigation-link" data-active={route.page === 'settings'}>
            <MoreHorizontal size={18} strokeWidth={1.75} aria-hidden />
            <span>{copy.navigation.more}</span>
          </SheetTrigger>
          <SheetContent side="bottom" className="navigation-sheet" showCloseButton={false}>
            <SheetHeader>
              <SheetTitle>{copy.navigation.label}</SheetTitle>
              <SheetDescription>{copy.navigation.description}</SheetDescription>
            </SheetHeader>
            <button className="navigation-close" aria-label={copy.navigation.close} onClick={() => setMore(false)}>
              <X size={18} aria-hidden />
            </button>
            <NavigationList groups={groups} route={route} onNavigate={() => setMore(false)} />
          </SheetContent>
        </Sheet>
      </nav>
    </>
  );
}

function NavigationList({ groups, route, onNavigate }: {
  groups: NavigationGroup[]; route: OpsRoute; onNavigate?: () => void;
}) {
  return (
    <nav className="navigation-groups" aria-label={copy.navigation.label}>
      {groups.map((group) => (
        <section className="navigation-group" key={group.id} aria-label={group.label}>
          <h2>{group.label}</h2>
          {group.items.map((item) => (
            <NavigationLink key={item.id} item={item} route={route} onNavigate={onNavigate} />
          ))}
        </section>
      ))}
    </nav>
  );
}

function NavigationLink({ item, route, onNavigate }: {
  item: NavigationItem; route: OpsRoute; onNavigate?: () => void;
}) {
  const Icon = ICONS[item.id];
  return (
    <a href={item.href} className="navigation-link"
      aria-current={isNavigationActive(item, route) ? 'page' : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openNavigation(item);
        onNavigate?.();
      }}>
      <Icon size={18} strokeWidth={1.75} aria-hidden />
      <span>{item.label}</span>
    </a>
  );
}
