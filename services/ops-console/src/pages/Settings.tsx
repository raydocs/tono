import { copy } from '@/copy/copy';
import { resolveSection, type SettingsSection } from '@/lib/settings';
import { cn } from '@/lib/utils';
import '@/styles/settings.css';
import { Alerts } from './settings/Alerts';
import { Allowlist } from './settings/Allowlist';
import { Audit } from './settings/Audit';
import { Candidates } from './settings/Candidates';
import { Catalog } from './settings/Catalog';
import { HomeInventory } from './settings/HomeInventory';
import { HomeLines } from './settings/HomeLines';
import { Ledger } from './settings/Ledger';
import { Policy } from './settings/Policy';
import { Providers } from './settings/Providers';

/** The sections that are dashboards take the wider column the dashboard pages use. */
const WIDE: ReadonlySet<SettingsSection> = new Set(['homeinventory', 'homelines']);

export default function SettingsPage({ section }: { section: string | null }) {
  const active = resolveSection(section);

  return (
    <div className={cn('page-wrap settings-page', WIDE.has(active) && 'settings-wide')}>
      <div className="settings-layout flex flex-col gap-6 min-[900px]:flex-row min-[900px]:gap-10">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <header className="settings-hero flex flex-col gap-1">
            <h2 className="text-page">{copy.settings.sections[active]}</h2>
            <p className="text-body text-[var(--muted-foreground)]">
              {copy.settings.sectionLead[active]}
            </p>
          </header>
          <Body section={active} />
        </div>
      </div>
    </div>
  );
}

function Body({ section }: { section: SettingsSection }) {
  if (section === 'catalog') return <Catalog />;
  if (section === 'policy') return <Policy />;
  if (section === 'homeinventory') return <HomeInventory />;
  if (section === 'homelines') return <HomeLines />;
  if (section === 'ledger') return <Ledger />;
  if (section === 'providers') return <Providers />;
  if (section === 'candidates') return <Candidates />;
  if (section === 'allowlist') return <Allowlist />;
  if (section === 'audit') return <Audit />;
  return <Alerts />;
}
