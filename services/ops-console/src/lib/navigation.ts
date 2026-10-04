import { copy, type PageId } from '@/copy/copy';
import { goPage, openSettings, type OpsRoute } from './hash-route';
import { can, PAGE_REQUIRES, type OpsRole } from './roles';
import { resolveSection, type SettingsSection } from './settings';

type NavigationId = Exclude<PageId, 'settings'> | SettingsSection;
type GroupId = keyof typeof copy.navigation.groups;

export type NavigationItem = {
  id: NavigationId;
  page: PageId;
  section?: SettingsSection;
  label: string;
  href: string;
  keywords: readonly string[];
};

export type NavigationGroup = {
  id: GroupId;
  label: string;
  items: NavigationItem[];
};

function page(id: Exclude<PageId, 'settings'>): NavigationItem {
  return { id, page: id, label: copy.pages[id], href: `#/${id}`, keywords: copy.navigation.aliases[id] };
}

function section(id: SettingsSection): NavigationItem {
  return { id, page: 'settings', section: id, label: copy.settings.sections[id],
    href: `#/settings/${id}`, keywords: copy.navigation.aliases[id] };
}

// Existing URLs and permission gates remain authoritative. The sidebar, phone
// menu and command palette share this inventory rather than naming pages twice.
const GROUPS: NavigationGroup[] = [
  { id: 'workbench', label: copy.navigation.groups.workbench, items: [page('today')] },
  { id: 'customers', label: copy.navigation.groups.customers, items: [page('customers'), section('allowlist')] },
  { id: 'resources', label: copy.navigation.groups.resources,
    items: [page('nodes'), section('homeinventory'), section('homelines'), section('providers')] },
  { id: 'finance', label: copy.navigation.groups.finance, items: [page('traffic'), section('ledger')] },
  { id: 'system', label: copy.navigation.groups.system,
    items: [page('clients'), section('alerts'), section('catalog'), section('policy'), section('candidates'), section('audit')] },
];

export function visibleNavigation(role: OpsRole): NavigationGroup[] {
  return GROUPS.map((group) => ({ ...group,
    items: group.items.filter((item) => can(PAGE_REQUIRES[item.page], role)),
  })).filter((group) => group.items.length > 0);
}

export function isNavigationActive(item: NavigationItem, route: OpsRoute): boolean {
  return item.page === route.page
    && (item.page !== 'settings' || item.section === resolveSection(route.section));
}

export function navigationContext(route: OpsRoute, role: OpsRole) {
  for (const group of visibleNavigation(role)) {
    const item = group.items.find((entry) => isNavigationActive(entry, route));
    if (item) return { group: group.label, title: item.label };
  }
  return { group: null, title: copy.pages[route.page] };
}

export function openNavigation(item: NavigationItem) {
  if (item.section) openSettings(item.section);
  else goPage(item.page);
}
