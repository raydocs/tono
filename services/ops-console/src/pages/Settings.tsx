import { copy } from '@/copy/copy';
import { openSettings } from '@/lib/hash-route';
import { resolveSection, SETTINGS_SECTIONS, type SettingsSection } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { Alerts } from './settings/Alerts';
import { Audit } from './settings/Audit';
import { Candidates } from './settings/Candidates';
import { Catalog } from './settings/Catalog';
import { HomeInventory } from './settings/HomeInventory';
import { HomeLines } from './settings/HomeLines';
import { Policy } from './settings/Policy';
import { Providers } from './settings/Providers';

/**
 * The settings page: eight surfaces behind one rail.
 *
 * Deliberately plain: no health words, no tones, no counts in the headline.
 * Nothing on this page is a measurement, and borrowing the incident page's
 * colours for a cooldown value would teach the operator that violet on a
 * settings row means something. The rail lives inside the page rather than in
 * the shell because these are one operator's occasional errands, not five
 *
 * places they live.
 *
 * Each section is addressable — `#/settings/audit` is a link worth pasting
 * into a note — and a hash that names none of them lands on the alert rules,
 * which is the section an operator opens without being sent to it.
 */
export default function SettingsPage({ section }: { section: string | null }) {
  const active = resolveSection(section);

  return (
    <div className="page-wrap">
      <div className="flex flex-col gap-6 min-[900px]:flex-row min-[900px]:gap-10">
        <Rail active={active} />
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <header className="flex flex-col gap-1">
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
  if (section === 'providers') return <Providers />;
  if (section === 'candidates') return <Candidates />;
  if (section === 'audit') return <Audit />;
  return <Alerts />;
}

/**
 * The eight names, and which one you are on.
 *
 * A rule on the left rather than a filled pill: the shell's nav already owns
 * the filled-pill idiom for pages, and reusing it one level down made the two
 * levels of navigation look like one flat list of eleven things.
 */
function Rail({ active }: { active: SettingsSection }) {
  return (
    <nav
      aria-label={copy.pages.settings}
      className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-b border-[var(--hairline)] pb-3 min-[900px]:w-[132px] min-[900px]:flex-col min-[900px]:gap-0 min-[900px]:border-b-0 min-[900px]:border-l min-[900px]:border-[var(--hairline)] min-[900px]:pb-0"
    >
      {SETTINGS_SECTIONS.map((id) => (
        <a
          key={id}
          href={`#/settings/${id}`}
          aria-current={active === id ? 'page' : undefined}
          className={cn(
            'group text-body min-[900px]:-ml-px min-[900px]:border-l-2 min-[900px]:py-1.5 min-[900px]:pl-3',
            active === id
              ? 'font-medium min-[900px]:border-[var(--accent)]'
              : 'min-[900px]:border-transparent',
          )}
          onClick={(event) => {
            event.preventDefault();
            openSettings(id);
          }}
        >
          {/* The colour lives on the span: `a { color: inherit }` in the sheet
              beats a utility class on the anchor itself, so a muted rail item
              set that way comes out the same black as the live one. */}
          <span
            className={cn(
              'transition-colors',
              active === id
                ? 'text-[var(--foreground)]'
                : 'text-[var(--muted-foreground)] group-hover:text-[var(--foreground)]',
            )}
          >
            {copy.settings.sections[id]}
          </span>
        </a>
      ))}
    </nav>
  );
}
