import { useEffect, useState } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import type { CustomerSummaryDto, IncidentDto, NodeSummaryDto } from '@contract';
import { copy, type PageId } from '@/copy/copy';
import { goPage, openCustomer, openIncident, openNode } from '@/lib/hash-route';
import { openIncidents } from '@/lib/incidents';
import { usePrivacy } from '@/lib/privacy';

const PAGE_IDS = Object.keys(copy.pages) as PageId[];

/**
 * Four things to type at: a page, an open incident, a customer, a machine.
 *
 * The node list is the engine's, not the legacy fleet read's, so ⌘K and the
 * nodes page hold the same fleet — a machine the console will not show you is a
 * machine you cannot jump to either.
 */
export function CommandPalette({
  nodes,
  customers,
  incidents,
}: {
  nodes: NodeSummaryDto[];
  customers: CustomerSummaryDto[];
  incidents: IncidentDto[];
}) {
  const [open, setOpen] = useState(false);
  const privacy = usePrivacy();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={copy.searchPrompt} description={copy.searchPrompt}>
      <CommandInput placeholder={copy.searchPrompt} />
      <CommandList>
        <CommandEmpty>{copy.commandEmpty}</CommandEmpty>
        <CommandGroup heading={copy.commandPages}>
          {PAGE_IDS.map((id) => (
            <CommandItem
              key={id}
              value={`${copy.pages[id]} ${id}`}
              onSelect={() => {
                goPage(id);
                setOpen(false);
              }}
            >
              {copy.pages[id]}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading={copy.commandIncidents}>
          {openIncidents(incidents).map((incident) => (
            <CommandItem
              key={incident.id}
              value={`${incident.title} ${incident.subjectId ?? ''}`}
              onSelect={() => {
                openIncident(incident.id);
                setOpen(false);
              }}
            >
              {incident.title}
            </CommandItem>
          ))}
        </CommandGroup>
        {/* Searchable by the real address either way — masking the label
            without masking the search value would leak it back on the first
            keystroke. */}
        <CommandGroup heading={copy.commandCustomers}>
          {customers.map((customer) => (
            <CommandItem
              key={customer.userId}
              value={privacy.privacy ? privacy.email(customer.email) : customer.email}
              onSelect={() => {
                openCustomer(customer.userId);
                setOpen(false);
              }}
            >
              {privacy.email(customer.email)}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading={copy.commandNodes}>
          {nodes.map((node) => (
            <CommandItem
              key={node.name}
              value={node.name}
              onSelect={() => {
                openNode(node.name);
                setOpen(false);
              }}
            >
              {node.name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
